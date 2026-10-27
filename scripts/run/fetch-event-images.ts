import path from 'node:path';
import { parseArgs } from 'node:util';
import { IndieEvent } from '../../schema/event.ts';
import { createSimpleHttp } from '../fetch/http.ts';
import { nowIso } from '../lib/clock.ts';
import { runMain } from '../lib/errors.ts';
import { fileKind, loadRepo, PROJECT_ROOT, repoPath, writeKind } from '../lib/repo-io.ts';
import { eventImagePath, fetchOgImageTo } from '../pipeline/article-images.ts';

// 催しの案内のページの OGP 画像を取得し、WebP で public/media/events/ に保存する
//   npm run media:events [-- --force]
await runMain(async () => {
  const { values } = parseArgs({ options: { force: { type: 'boolean', default: false } } });
  const repo = loadRepo();
  const http = createSimpleHttp({
    userAgent: 'Mozilla/5.0 (compatible; IndieAtlasBot/0.1)',
    minIntervalMs: repo.runtime.fetch.perDomainMinIntervalMs,
    timeoutMs: repo.runtime.fetch.timeoutSeconds * 1000,
    maxBytes: 8_000_000,
  });
  let done = 0;
  for (const e of repo.events) {
    if (e.image && !values.force) continue;
    try {
      // 案内のページになければ、根拠のページ（告知の記事など）の画像を使う
      let image;
      for (const page of [...new Set([e.url, ...e.evidence.map((x) => x.url)])]) {
        image = await fetchOgImageTo(http, page, eventImagePath(e.id), path.join(PROJECT_ROOT, 'public'));
        if (image) break;
      }
      if (!image) {
        console.log(`none ${e.id}: OGP 画像がない（${e.name}）`);
        continue;
      }
      writeKind(
        fileKind('event'),
        repoPath(`data/events/${e.id}.json`),
        IndieEvent.parse({ ...e, image, updatedAt: nowIso() }),
      );
      done++;
      console.log(`ok   ${e.id}: ${image.width}x${image.height} ${e.name}`);
    } catch (err) {
      console.error(`fail ${e.id}: ${(err as Error).message}`);
    }
  }
  console.log(`media:events: ${done} image(s)`);
});

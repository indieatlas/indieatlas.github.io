import path from 'node:path';
import { parseArgs } from 'node:util';
import { Article } from '../../schema/article.ts';
import { createSimpleHttp } from '../fetch/http.ts';
import { nowIso } from '../lib/clock.ts';
import { runMain } from '../lib/errors.ts';
import { fileKind, loadRepo, PROJECT_ROOT, repoPath, writeKind } from '../lib/repo-io.ts';
import { fetchArticleImage } from '../pipeline/article-images.ts';

// 記事の OGP 画像を取得し、WebP で public/media/articles/ に保存する
//   npm run media:articles [-- --force] [-- --id a_xxxxxxxxxxxxxxxx]
await runMain(async () => {
  const { values } = parseArgs({
    options: { force: { type: 'boolean', default: false }, id: { type: 'string', multiple: true } },
  });
  const repo = loadRepo();
  const rights = new Map(repo.sources.sources.map((s) => [s.id, s.rights]));
  const http = createSimpleHttp({
    userAgent: 'Mozilla/5.0 (compatible; IndieAtlasBot/0.1)',
    minIntervalMs: repo.runtime.fetch.perDomainMinIntervalMs,
    timeoutMs: repo.runtime.fetch.timeoutSeconds * 1000,
    maxBytes: 8_000_000,
  });
  let done = 0;
  for (const a of repo.articles) {
    if (values.id && !values.id.includes(a.id)) continue;
    if (a.image && !values.force) continue;
    const r = a.sourceId ? rights.get(a.sourceId) : undefined;
    // 画像を表示してよいと確かめた情報源の記事だけ。登録していない媒体の記事は使わない
    if (!r || !r.allowFetch || !r.displayImages) {
      console.log(`skip ${a.id}: 情報源の権利条件で画像を使えない`);
      continue;
    }
    try {
      const image = await fetchArticleImage(http, a, path.join(PROJECT_ROOT, 'public'));
      if (!image) {
        console.log(`none ${a.id}: OGP 画像がない`);
        continue;
      }
      writeKind(
        fileKind('article'),
        repoPath(`data/articles/${a.id}.json`),
        Article.parse({ ...a, image, updatedAt: nowIso() }),
      );
      done++;
      console.log(`ok   ${a.id}: ${image.width}x${image.height} ${a.title.slice(0, 40)}`);
    } catch (e) {
      console.error(`fail ${a.id}: ${(e as Error).message}`);
    }
  }
  console.log(`media:articles: ${done} image(s)`);
});

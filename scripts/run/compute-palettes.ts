import { parseArgs } from 'node:util';
import { ImagePalettes } from '../../schema/media.ts';
import { createSimpleHttp } from '../fetch/http.ts';
import { adoptedOf } from '../lib/claims-view.ts';
import { nowIso } from '../lib/clock.ts';
import { runMain } from '../lib/errors.ts';
import { dominantColors } from '../lib/image.ts';
import { fileKind, loadRepo, repoPath, writeKind } from '../lib/repo-io.ts';

// 作品のヘッダー画像から主な色を抽出し、data/media/palettes.json に保存する（作品詳細のページの色に使う）
//   npm run media:palettes [-- --force]
await runMain(async () => {
  const { values } = parseArgs({ options: { force: { type: 'boolean', default: false } } });
  const repo = loadRepo();
  const http = createSimpleHttp({
    userAgent: 'IndieAtlasBot/0.1',
    minIntervalMs: 300,
    timeoutMs: 20_000,
    maxBytes: 8_000_000,
  });
  const out: ImagePalettes = structuredClone(repo.palettes);
  let n = 0;
  for (const g of repo.games.filter((x) => x.status === 'published')) {
    const claims = repo.claims.get(g.id)?.claims ?? [];
    const image = adoptedOf(claims, 'image').find((c) => c.value.role === 'header') ?? adoptedOf(claims, 'image')[0];
    if (!image) continue;
    const prev = out.entries[g.id];
    if (prev && prev.imageUrl === image.value.url && !values.force) continue;
    try {
      const res = await http.get(image.value.url);
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      const colors = await dominantColors(res.bytes);
      out.entries[g.id] = { imageUrl: image.value.url, colors, computedAt: nowIso() };
      n++;
      console.log(`ok   ${g.id} ${colors.join(' ')} ${g.title.display}`);
    } catch (e) {
      console.error(`fail ${g.id}: ${(e as Error).message}`);
    }
  }
  writeKind(fileKind('palettes'), repoPath('data/media/palettes.json'), out);
  console.log(`media:palettes: ${n} palette(s)`);
});

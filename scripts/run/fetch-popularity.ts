import { PopularityMetrics } from '../../schema/media.ts';
import { createSimpleHttp } from '../fetch/http.ts';
import { nowIso } from '../lib/clock.ts';
import { runMain } from '../lib/errors.ts';
import { fileKind, loadRepo, repoPath, writeKind } from '../lib/repo-io.ts';

// Steam のレビュー数を取得し、data/metrics/popularity.json に保存する（作品の見せ方の強弱に使う）
//   npm run metrics:popularity
await runMain(async () => {
  const repo = loadRepo();
  const http = createSimpleHttp({
    userAgent: 'IndieAtlasBot/0.1',
    minIntervalMs: 1_200,
    timeoutMs: 20_000,
    maxBytes: 200_000,
  });
  const out: PopularityMetrics = structuredClone(repo.popularity);
  let n = 0;
  for (const g of repo.games.filter((x) => x.status === 'published' && x.externalIds.steamAppId)) {
    const appId = g.externalIds.steamAppId!;
    try {
      const res = await http.get(
        `https://store.steampowered.com/api/appdetails?appids=${appId}&filters=recommendations`,
      );
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      const body = JSON.parse(res.text) as Record<
        string,
        { success: boolean; data?: { recommendations?: { total?: number } } | [] }
      >;
      const entry = body[String(appId)];
      if (!entry?.success) throw new Error('not found');
      const data = Array.isArray(entry.data) ? undefined : entry.data;
      out.entries[g.id] = { steamReviews: data?.recommendations?.total ?? 0, retrievedAt: nowIso() };
      n++;
      console.log(`ok   ${g.id} ${out.entries[g.id]!.steamReviews} ${g.title.display}`);
    } catch (e) {
      console.error(`fail ${g.id}: ${(e as Error).message}`);
    }
  }
  writeKind(fileKind('popularity'), repoPath('data/metrics/popularity.json'), out);
  console.log(`metrics:popularity: ${n} game(s)`);
});

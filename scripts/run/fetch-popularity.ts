import fs from 'node:fs';
import path from 'node:path';
import { PopularityMetrics } from '../../schema/media.ts';
import { createSimpleHttp } from '../fetch/http.ts';
import { nowIso } from '../lib/clock.ts';
import { runMain } from '../lib/errors.ts';
import { fileKind, loadRepo, PROJECT_ROOT, repoPath, writeKind } from '../lib/repo-io.ts';
import { createIgdbClient, igdbRatings } from '../sources/igdb.ts';
import { appReviewsUrl, parseReviewSummary, parseStoreReviewScore, storeReviewPageUrl } from '../sources/steam.ts';

// Steam のレビュー数と IGDB の評価を取得し、data/metrics/popularity.json に保存する
// （作品の見せ方の強弱と、作品詳細の評価の表示に使う）。IGDB はキーがあるときだけ
//   npm run metrics:popularity
await runMain(async () => {
  const envFile = path.join(PROJECT_ROOT, '.env');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
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
      // 好評の割合は取れる環境でだけ取る（取れなければ前の値を残す）
      const reviews = await http.get(appReviewsUrl(appId)).catch(() => undefined);
      let score = reviews?.status === 200 ? parseReviewSummary(reviews.text) : undefined;
      // appreviews を取れない環境では、ストアのページの日本語のレビューの集計を使う
      if (!score) {
        const page = await http.get(storeReviewPageUrl(appId)).catch(() => undefined);
        score = page?.status === 200 ? parseStoreReviewScore(page.text) : undefined;
      }
      out.entries[g.id] = {
        ...out.entries[g.id],
        steamReviews: data?.recommendations?.total ?? 0,
        ...(score ? { steamScore: score } : {}),
        retrievedAt: nowIso(),
      };
      n++;
      console.log(`ok   ${g.id} ${out.entries[g.id]!.steamReviews} ${g.title.display}`);
    } catch (e) {
      console.error(`fail ${g.id}: ${(e as Error).message}`);
    }
  }
  const clientId = process.env.IGDB_CLIENT_ID;
  const clientSecret = process.env.IGDB_CLIENT_SECRET;
  if (clientId && clientSecret) {
    const igdbHttp = createSimpleHttp({
      userAgent: 'IndieAtlasBot/0.1',
      minIntervalMs: 300,
      timeoutMs: 20_000,
      maxBytes: 5_000_000,
    });
    const client = await createIgdbClient(igdbHttp, { clientId, clientSecret });
    const byIgdb = new Map(
      repo.games.filter((g) => g.status === 'published' && g.externalIds.igdbId).map((g) => [g.externalIds.igdbId!, g]),
    );
    for (const r of await igdbRatings(client, [...byIgdb.keys()])) {
      const g = byIgdb.get(r.id);
      const entry = g && out.entries[g.id];
      if (!entry) continue;
      const round = (v: number | undefined) => (v === undefined ? undefined : Math.round(v * 10) / 10);
      const igdb = {
        ...(r.total_rating !== undefined ? { total: round(r.total_rating), totalCount: r.total_rating_count ?? 0 } : {}),
        ...(r.aggregated_rating !== undefined
          ? { critic: round(r.aggregated_rating), criticCount: r.aggregated_rating_count ?? 0 }
          : {}),
      };
      if (Object.keys(igdb).length) entry.igdb = igdb;
    }
  }
  writeKind(fileKind('popularity'), repoPath('data/metrics/popularity.json'), out);
  console.log(`metrics:popularity: ${n} game(s)`);
});

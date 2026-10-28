import fs from 'node:fs';
import path from 'node:path';
import { SteamRanking } from '../../schema/amazon.ts';
import { STEAM_RANKING_FILE } from '../build/prepare-site.ts';
import { createSimpleHttp } from '../fetch/http.ts';
import { nowIso } from '../lib/clock.ts';
import { runMain } from '../lib/errors.ts';
import { PROJECT_ROOT } from '../lib/repo-io.ts';
import { createIgdbClient, igdbGames, igdbIdsForSteam, mapPlatform } from '../sources/igdb.ts';
import { indieTopSellersUrl, parseTopSellers } from '../sources/steam.ts';

const CONSOLES = new Set(['switch', 'switch2', 'ps5', 'ps4', 'xbox-series', 'xbox-one']);

/** IGDB で、それぞれの作品が出ている家庭用ゲーム機を調べる。キーがなければ undefined */
async function consolesByApp(appIds: number[]): Promise<Map<number, string[]> | undefined> {
  const clientId = process.env.IGDB_CLIENT_ID;
  const clientSecret = process.env.IGDB_CLIENT_SECRET;
  if (!clientId || !clientSecret) return undefined;
  const http = createSimpleHttp({
    userAgent: 'IndieAtlasBot/0.1',
    minIntervalMs: 300,
    timeoutMs: 20_000,
    maxBytes: 5_000_000,
  });
  const client = await createIgdbClient(http, { clientId, clientSecret });
  const ids = await igdbIdsForSteam(client, appIds);
  const games = new Map((await igdbGames(client, [...new Set(ids.values())])).map((g) => [g.id, g]));
  const out = new Map<number, string[]>();
  for (const app of appIds) {
    const g = games.get(ids.get(app) ?? -1);
    if (!g) continue;
    const consoles = [
      ...new Set(
        (g.platforms ?? [])
          .map((p) => mapPlatform(p.slug))
          .filter((p): p is NonNullable<typeof p> => !!p && CONSOLES.has(p)),
      ),
    ];
    out.set(app, consoles);
  }
  return out;
}

// Steam のインディーの売上上位を取得し、.generated/ranking/steam.json に書く（コミットしない）。
// IGDB のキーがあれば、家庭用ゲーム機で出ているかも調べる（Amazon へのリンクを付けるかの判断に使う）
//   npm run ranking:steam
await runMain(async () => {
  const envFile = path.join(PROJECT_ROOT, '.env');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const http = createSimpleHttp({
    userAgent: 'IndieAtlasBot/0.1',
    minIntervalMs: 1_000,
    timeoutMs: 20_000,
    maxBytes: 2_000_000,
  });
  const res = await http.get(indieTopSellersUrl());
  const items = res.status === 200 ? parseTopSellers(res.text) : undefined;
  if (!items) {
    console.log(`ranking:steam: 取得できない（HTTP ${res.status}）`);
    return;
  }
  const top = items.slice(0, 30);
  const consoles = await consolesByApp(top.map((i) => i.appId)).catch((e: Error) => {
    console.log(`ranking:steam: IGDB で機種を調べられない（${e.message}）`);
    return undefined;
  });
  const ranking = SteamRanking.parse({
    schemaVersion: 1,
    fetchedAt: nowIso(),
    items: top.map((i) => ({ ...i, ...(consoles?.has(i.appId) ? { consoles: consoles.get(i.appId) } : {}) })),
  });
  fs.mkdirSync(path.dirname(STEAM_RANKING_FILE), { recursive: true });
  fs.writeFileSync(STEAM_RANKING_FILE, JSON.stringify(ranking, null, 2) + '\n');
  console.log(`ranking:steam: ${ranking.items.length} item(s) → ${STEAM_RANKING_FILE}`);
});

import fs from 'node:fs';
import path from 'node:path';
import { SteamRanking } from '../../schema/amazon.ts';
import { STEAM_RANKING_FILE } from '../build/prepare-site.ts';
import { createSimpleHttp } from '../fetch/http.ts';
import { nowIso } from '../lib/clock.ts';
import { runMain } from '../lib/errors.ts';
import { indieTopSellersUrl, parseTopSellers } from '../sources/steam.ts';

// Steam のインディーの売上上位を取得し、.generated/ranking/steam.json に書く（コミットしない）
//   npm run ranking:steam
await runMain(async () => {
  const http = createSimpleHttp({ userAgent: 'IndieAtlasBot/0.1', minIntervalMs: 1_000, timeoutMs: 20_000, maxBytes: 2_000_000 });
  const res = await http.get(indieTopSellersUrl());
  const items = res.status === 200 ? parseTopSellers(res.text) : undefined;
  if (!items) {
    console.log(`ranking:steam: 取得できない（HTTP ${res.status}）`);
    return;
  }
  const ranking = SteamRanking.parse({ schemaVersion: 1, fetchedAt: nowIso(), items: items.slice(0, 30) });
  fs.mkdirSync(path.dirname(STEAM_RANKING_FILE), { recursive: true });
  fs.writeFileSync(STEAM_RANKING_FILE, JSON.stringify(ranking, null, 2) + '\n');
  console.log(`ranking:steam: ${ranking.items.length} item(s) → ${STEAM_RANKING_FILE}`);
});

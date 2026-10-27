import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ClaimsFile } from '../../schema/claim.ts';
import { Game } from '../../schema/game.ts';
import { createSimpleHttp } from '../fetch/http.ts';
import { nowIso, todayJst } from '../lib/clock.ts';
import { runMain, UserError } from '../lib/errors.ts';
import { fileKind, loadRepo, PROJECT_ROOT, repoPath, writeKind } from '../lib/repo-io.ts';
import { applyIgdb } from '../pipeline/igdb-sync.ts';
import { createIgdbClient, igdbGames, igdbIdsForSteam } from '../sources/igdb.ts';

// IGDB から、Steam 以外の機種の発売情報、スクリーンショット、ストアへのリンクを取り込む
//   npm run igdb:sync [-- --game g_000001] [-- --by human|agent]
// キーは環境変数 IGDB_CLIENT_ID と IGDB_CLIENT_SECRET（ローカルでは .env）から読む
await runMain(async () => {
  const envFile = path.join(PROJECT_ROOT, '.env');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const { values } = parseArgs({
    options: {
      game: { type: 'string', multiple: true },
      by: { type: 'string', default: 'agent' },
      run: { type: 'string', default: 'local-igdb' },
    },
  });
  const clientId = process.env.IGDB_CLIENT_ID;
  const clientSecret = process.env.IGDB_CLIENT_SECRET;
  if (!clientId || !clientSecret)
    throw new UserError('IGDB_CLIENT_ID と IGDB_CLIENT_SECRET を .env か環境変数に設定する');
  if (values.by !== 'human' && values.by !== 'agent') throw new UserError('--by は human か agent');

  const repo = loadRepo();
  const targets = repo.games.filter(
    (g) => g.status !== 'merged' && g.externalIds.steamAppId && (!values.game || values.game.includes(g.id)),
  );
  // IGDB の利用上限は毎秒4件まで
  const http = createSimpleHttp({
    userAgent: 'IndieAtlasBot/0.1',
    minIntervalMs: 300,
    timeoutMs: 20_000,
    maxBytes: 5_000_000,
  });
  const client = await createIgdbClient(http, { clientId, clientSecret });
  const map = await igdbIdsForSteam(
    client,
    targets.map((g) => g.externalIds.steamAppId!),
  );
  const games = new Map((await igdbGames(client, [...new Set(map.values())])).map((g) => [g.id, g]));
  const at = nowIso();
  const today = todayJst();
  let changed = 0;
  for (const g of targets) {
    const igdbId = map.get(g.externalIds.steamAppId!);
    const ig = igdbId ? games.get(igdbId) : undefined;
    if (!ig) {
      console.log(`skip ${g.id} ${g.title.display}: IGDB に見つからない`);
      continue;
    }
    const r = applyIgdb(g, repo.claims.get(g.id), ig, { at, today, createdBy: values.by, runId: values.run! });
    if (JSON.stringify(r.game) !== JSON.stringify(g))
      writeKind(fileKind('game'), repoPath(`data/games/${g.id}.json`), Game.parse(r.game));
    if (r.added.releases.length || r.added.screenshots || r.added.stores.length) {
      writeKind(fileKind('claims'), repoPath(`data/claims/${g.id}.json`), ClaimsFile.parse(r.claims));
      changed++;
    }
    console.log(
      `ok   ${g.id} ${g.title.display} → igdb:${ig.id} releases+[${r.added.releases.join(', ')}] screenshots+${r.added.screenshots} stores+[${r.added.stores.join(', ')}]`,
    );
  }
  console.log(`igdb:sync: ${changed} game(s) updated`);
});

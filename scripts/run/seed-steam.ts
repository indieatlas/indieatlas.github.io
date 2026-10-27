import { parseArgs } from 'node:util';
import { ClaimsFile } from '../../schema/claim.ts';
import { Developer } from '../../schema/developer.ts';
import { Game } from '../../schema/game.ts';
import { createSimpleHttp } from '../fetch/http.ts';
import { runMain, UserError } from '../lib/errors.ts';
import { fileKind, loadRepo, repoPath, writeKind } from '../lib/repo-io.ts';
import { seedFromSteam } from '../pipeline/seed-steam.ts';

// Steam の作品情報から候補の作品と Claim を作る（初期データ作成の補助。09 P1-04）
//   npm run seed:steam -- --app 413150 [--app ...] [--by human|agent]
await runMain(async () => {
  const { values } = parseArgs({
    options: {
      app: { type: 'string', multiple: true },
      by: { type: 'string', default: 'human' },
      run: { type: 'string', default: 'local-seed' },
    },
  });
  const appIds = (values.app ?? []).map(Number);
  if (appIds.length === 0 || appIds.some((n) => !Number.isInteger(n) || n <= 0)) {
    throw new UserError('使い方: npm run seed:steam -- --app {steamAppId} [--app ...] [--by human|agent]');
  }
  if (values.by !== 'human' && values.by !== 'agent') throw new UserError('--by は human か agent');
  const runtime = loadRepo().runtime;
  const http = createSimpleHttp({
    userAgent: runtime.fetch.userAgent
      .replace('{SITE_URL}', process.env.SITE_URL || 'http://localhost:4321')
      .replace('{BASE_PATH}', process.env.BASE_PATH || '/'),
    minIntervalMs: runtime.fetch.perDomainMinIntervalMs,
    timeoutMs: runtime.fetch.timeoutSeconds * 1000,
    maxBytes: runtime.fetch.maxBytes,
  });
  for (const appId of appIds) {
    const repo = loadRepo(); // 1件ごとに読み直し、前の結果を反映する
    const r = await seedFromSteam(http, repo, appId, { createdBy: values.by, runId: values.run! });
    for (const g of r.games) writeKind(fileKind('game'), repoPath(`data/games/${g.id}.json`), Game.parse(g));
    for (const d of r.developers)
      writeKind(fileKind('developer'), repoPath(`data/developers/${d.id}.json`), Developer.parse(d));
    if (r.claims) writeKind(fileKind('claims'), repoPath(`data/claims/${r.gameId}.json`), ClaimsFile.parse(r.claims));
    const title = r.games[0]?.title.display ?? '';
    console.log(`${appId} → ${r.gameId} ${title}${r.created ? '（新規）' : ''} claims+${r.claimsAdded}`);
    for (const n of r.notes) console.log(`  - ${n}`);
  }
});

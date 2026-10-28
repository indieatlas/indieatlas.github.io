import fs from 'node:fs';
import path from 'node:path';
import { AmazonRanking } from '../../schema/amazon.ts';
import { site } from '../../src/config/site.ts';
import { createSimpleHttp } from '../fetch/http.ts';
import { nowIso } from '../lib/clock.ts';
import { runMain } from '../lib/errors.ts';
import { PROJECT_ROOT } from '../lib/repo-io.ts';
import { AMAZON_RANKING_FILE } from '../build/prepare-site.ts';
import { createCreatorsClient, fetchRanking } from '../sources/amazon.ts';

// Amazon のゲームの売れ筋を Creators API から取得し、.generated/amazon/ranking.json に書く（コミットしない）
//   npm run amazon:ranking
// キーは AMAZON_CREATORS_CREDENTIAL_ID、AMAZON_CREATORS_CREDENTIAL_SECRET、AMAZON_CREATORS_VERSION（既定 3.3）。
// キーがなければ何もしない（サイトは売れ筋の欄を出さず、Amazon のランキングへのリンクだけにする）
await runMain(async () => {
  const envFile = path.join(PROJECT_ROOT, '.env');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const credentialId = process.env.AMAZON_CREATORS_CREDENTIAL_ID;
  const credentialSecret = process.env.AMAZON_CREATORS_CREDENTIAL_SECRET;
  if (!credentialId || !credentialSecret || !site.amazonTag) {
    console.log('amazon:ranking: キーかトラッキング ID がないので取得しない');
    return;
  }
  const http = createSimpleHttp({ userAgent: 'IndieAtlasBot/0.1', minIntervalMs: 1_100, timeoutMs: 20_000, maxBytes: 5_000_000 });
  const client = await createCreatorsClient(http, {
    credentialId,
    credentialSecret,
    version: process.env.AMAZON_CREATORS_VERSION || '3.3',
  });
  let ranking: AmazonRanking;
  try {
    ranking = AmazonRanking.parse(await fetchRanking(client, site.amazonTag, nowIso()));
  } catch (e) {
    // アソシエイトの実績が条件に届かないうちは AssociateNotEligible が返る。売れ筋の欄を出さずに続ける
    if (/AssociateNotEligible/.test((e as Error).message)) {
      console.log('amazon:ranking: アカウントが Creators API の利用条件をまだ満たしていない（AssociateNotEligible）。取得しない');
      return;
    }
    throw e;
  }
  fs.mkdirSync(path.dirname(AMAZON_RANKING_FILE), { recursive: true });
  fs.writeFileSync(AMAZON_RANKING_FILE, JSON.stringify(ranking, null, 2) + '\n');
  console.log(`amazon:ranking: ${ranking.items.length} item(s) → ${AMAZON_RANKING_FILE}`);
});

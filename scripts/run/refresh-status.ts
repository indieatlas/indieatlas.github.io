import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { todayJst } from '../lib/clock.ts';
import { runMain } from '../lib/errors.ts';
import { loadRepo, PROJECT_ROOT } from '../lib/repo-io.ts';
import { lookupUrls, refreshStatus } from '../pipeline/refresh-status.ts';

// サイトの内容のうち、古くなったもの、確かめ直すものを JSON で出力する（12 §12.6.7）。外部とは通信しない
//   npm run refresh:status
//   npm run refresh:status -- --url https://example.com/news/1 [--url ...]   記事の URL が登録済みかを調べる
await runMain(() => {
  const envFile = path.join(PROJECT_ROOT, '.env');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const { values } = parseArgs({ options: { url: { type: 'string', multiple: true } } });
  const repo = loadRepo();
  if (values.url) {
    console.log(JSON.stringify(lookupUrls(repo, values.url), null, 2));
    return;
  }
  // キーの値は出さず、あるかどうかだけを出す
  const keys = {
    igdb: !!(process.env.IGDB_CLIENT_ID && process.env.IGDB_CLIENT_SECRET),
    llm: !!process.env[repo.runtime.llm.apiKeyEnv],
  };
  console.log(JSON.stringify({ keys, ...refreshStatus(repo, todayJst()) }, null, 2));
});

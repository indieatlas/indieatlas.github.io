import fs from 'node:fs';
import path from 'node:path';
import { decidePublish } from '../build/publish-check.ts';
import { siteEnv } from '../build/prepare-site.ts';
import { createSimpleHttp } from '../fetch/http.ts';
import { now } from '../lib/clock.ts';
import { runMain } from '../lib/errors.ts';
import { PROJECT_ROOT } from '../lib/repo-io.ts';

// 公開済みの manifest と比べ、デプロイが必要かを判定する（07 §7.6）
await runMain(async () => {
  const local = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'dist/build-manifest.json'), 'utf8')) as {
    contentHash: string;
  };
  const env = siteEnv();
  const http = createSimpleHttp({
    userAgent: 'IndieAtlasBot/0.1',
    minIntervalMs: 0,
    timeoutMs: 10_000,
    maxBytes: 1_000_000,
  });
  const remote = `${env.SITE_URL.replace(/\/$/, '')}${env.BASE_PATH}build-manifest.json?t=${now().getTime()}`;
  const decision = await decidePublish({
    contentHash: local.contentHash,
    force: process.env.FORCE_DEPLOY === 'true',
    fetchRemote: async () => {
      const r = await http.get(remote);
      return { status: r.status, body: r.text };
    },
  });
  const lines = [
    `should_deploy=${decision.shouldDeploy}`,
    `reason=${decision.reason}`,
    `content_hash=${decision.contentHash}`,
  ];
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n');
  console.log(lines.join('\n'));
});

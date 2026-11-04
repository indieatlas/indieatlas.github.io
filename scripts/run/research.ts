import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { botUserAgent, createFetcher, nodeTransport } from '../fetch/fetcher.ts';
import { createSimpleHttp } from '../fetch/http.ts';
import { now, toIsoDateTime, toJstDate } from '../lib/clock.ts';
import { runMain, UserError } from '../lib/errors.ts';
import { loadRepo, PROJECT_ROOT, repoPath } from '../lib/repo-io.ts';
import { registrableDomain } from '../lib/domains.ts';
import { createLlmClient, modelsAvailable } from '../llm/index.ts';
import { runResearch } from '../pipeline/research.ts';

// 調査ジョブ（06 §6.1）。data/ は書き換えず、提案を out/ に書く
//   npm run research -- --out out/research [--mode full|collect-only] [--max-tasks N]
await runMain(async () => {
  const { values } = parseArgs({
    options: {
      out: { type: 'string', default: 'out/research' },
      mode: { type: 'string', default: 'full' },
      'max-tasks': { type: 'string' },
    },
  });
  if (values.mode !== 'full' && values.mode !== 'collect-only') throw new UserError('--mode は full か collect-only');
  // 手元では .env の API キーを使う。CI では環境のシークレットから渡す
  const envFile = path.join(PROJECT_ROOT, '.env');
  if (!process.env.CI && fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const repo = loadRepo();
  const runtime = repo.runtime;
  const ua = botUserAgent(runtime.fetch.userAgent);
  const intervals = new Map(
    repo.sources.sources
      .filter((s) => s.fetch.minIntervalMs)
      .map((s) => [registrableDomain(s.homepage), s.fetch.minIntervalMs!]),
  );
  const fetcher = createFetcher(nodeTransport(), {
    userAgent: ua,
    timeoutMs: runtime.fetch.timeoutSeconds * 1000,
    maxBytes: runtime.fetch.maxBytes,
    minIntervalMs: runtime.fetch.perDomainMinIntervalMs,
    intervalFor: (host) => intervals.get(registrableDomain(host)),
  });
  const steamEnabled = repo.sources.sources.some((s) => s.id === 'steam-store' && s.enabled && s.rights.allowFetch);
  const steamHttp = steamEnabled
    ? createSimpleHttp({
        userAgent: ua,
        minIntervalMs: runtime.fetch.perDomainMinIntervalMs,
        timeoutMs: runtime.fetch.timeoutSeconds * 1000,
        maxBytes: runtime.fetch.maxBytes,
      })
    : undefined;
  let { client, disabledReason } = createLlmClient(runtime, process.env, { userAgent: ua });
  if (client) {
    const http = createSimpleHttp({ userAgent: ua, minIntervalMs: 0, timeoutMs: 20_000, maxBytes: 2_000_000 });
    if (!(await modelsAvailable(runtime, http, process.env[runtime.llm.apiKeyEnv]!))) {
      disabledReason = '設定したモデルが接続先の一覧にない';
      client = undefined;
    }
  }
  const started = now();
  const runId =
    process.env.RUN_ID ||
    `local-${toJstDate(started).replace(/-/g, '')}-${toIsoDateTime(new Date(started.getTime() + 9 * 3_600_000))
      .slice(11, 19)
      .replace(/:/g, '')}-research`;
  const triggerCommit =
    process.env.TRIGGER_COMMIT || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: PROJECT_ROOT }).toString().trim();
  const event = process.env.GITHUB_EVENT_NAME;
  const trigger = event === 'schedule' || event === 'workflow_dispatch' || event === 'push' ? event : 'local';
  const policy = fs.readFileSync(repoPath('config/policy.md'), 'utf8');
  const outDir = path.resolve(PROJECT_ROOT, values.out!);
  fs.rmSync(outDir, { recursive: true, force: true });
  const meta = await runResearch({
    repo,
    outDir,
    mode: values.mode,
    runId,
    runAttempt: Number(process.env.RUN_ATTEMPT || 1),
    trigger,
    triggerCommit,
    fetcher,
    ...(steamHttp ? { steamHttp } : {}),
    ...(client ? { llm: client } : {}),
    ...(disabledReason ? { llmDisabledReason: disabledReason } : {}),
    policy,
    ...(values['max-tasks'] ? { maxTasks: Number(values['max-tasks']) } : {}),
    log: (line) => console.log(line),
  });
  console.log(`research: ${meta.runId} ${meta.mode} ${meta.stopReason} → ${path.relative(PROJECT_ROOT, outDir)}`);
});

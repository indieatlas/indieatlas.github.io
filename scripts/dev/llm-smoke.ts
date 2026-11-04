import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { createSimpleHttp } from '../fetch/http.ts';
import { PROJECT_ROOT, loadRepo } from '../lib/repo-io.ts';
import { createLlmClient, modelsAvailable } from '../llm/index.ts';
import { costOf } from '../llm/pricing.ts';

// OpenCode Go の接続を手元で確かめる（09 P2-04）。.env の OPENCODE_API_KEY を使う
//   npx tsx scripts/dev/llm-smoke.ts
const envFile = path.join(PROJECT_ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const runtime = loadRepo().runtime;
const ua = 'IndieAtlasBot/0.1 (smoke)';
const { client, disabledReason } = createLlmClient(runtime, process.env, { userAgent: ua });
if (!client) throw new Error(`LLM disabled: ${disabledReason}`);
const http = createSimpleHttp({ userAgent: ua, minIntervalMs: 0, timeoutMs: 30_000, maxBytes: 5_000_000 });
console.log('models available:', await modelsAvailable(runtime, http, process.env[runtime.llm.apiKeyEnv]!));

const usages: number[] = [];
const v = await client.generateObject({
  role: 'triage',
  sessionId: 'ia-smoke-json',
  system: '出力は JSON だけ: {"word": "<日本語の単語>"}',
  prompt: '単語を1つ',
  schema: z.object({ word: z.string() }),
  onUsage: (u) => usages.push(costOf(runtime.llm, u)),
});
console.log('json mode:', v);

const r = await client.runTools!({
  role: 'execute',
  sessionId: 'ia-smoke-tools',
  system: '道具を使って調べ、最後に submit を呼ぶ。',
  prompt: '東京の天気を調べて submit で返す。',
  tools: [
    {
      name: 'get_weather',
      description: '都市の天気',
      input: z.object({ city: z.string() }),
      run: async () => ({ ok: true, content: JSON.stringify({ sky: 'くもり', temp: 18 }) }),
    },
  ],
  finalTool: { name: 'submit', description: '結果', schema: z.object({ sky: z.string(), temp: z.number() }) },
  maxTurns: 4,
  onUsage: (u) => {
    usages.push(costOf(runtime.llm, u));
    console.log('usage', {
      prompt: u.promptTokens,
      cached: u.cachedTokens,
      out: u.completionTokens,
      allowance: u.allowanceUsd,
    });
  },
});
console.log('tools:', r.stop, r.value, `${r.turns} turns`);
console.log('total USD:', usages.reduce((a, b) => a + b, 0).toFixed(6));

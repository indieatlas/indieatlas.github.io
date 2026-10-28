// LLM の接続を確かめる（OPENCODE_API_KEY が使えるか）。npx tsx scripts/dev/llm-ping.ts
import { z } from 'zod';
import { createSimpleHttp } from '../fetch/http.ts';
import { createOpenAiCompatibleClient } from '../llm/client.ts';
import { loadRepo } from '../lib/repo-io.ts';
process.loadEnvFile(new URL('../../.env', import.meta.url));
const repo = loadRepo();
const roles = repo.runtime.llm.roles;
const llm = createOpenAiCompatibleClient(createSimpleHttp({ userAgent: 'IndieAtlasBot/0.1', minIntervalMs: 0, timeoutMs: 120_000, maxBytes: 5_000_000 }), {
  baseUrl: repo.runtime.llm.baseUrl, apiKey: process.env.OPENCODE_API_KEY!, sessionHeader: repo.runtime.llm.sessionHeader, userAgent: 'IndieAtlasBot/0.1',
  model: (r) => ({ model: roles[r].model, thinking: 'disabled', maxOutputTokens: 200 }),
});
const v = await llm.generateObject({ role: 'triage', sessionId: 'ia-ping', system: '出力は JSON だけ: {"ok": true, "word": "<任意の日本語の単語>"}', prompt: '返事をして', schema: z.object({ ok: z.boolean(), word: z.string() }), onUsage: (u) => console.log('usage', u) });
console.log(v);

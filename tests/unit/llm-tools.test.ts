import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createOpenAiCompatibleClient, type ToolSpec } from '../../scripts/llm/client.ts';
import { costOf, isPeak } from '../../scripts/llm/pricing.ts';
import { readJson, PROJECT_ROOT } from '../../scripts/lib/repo-io.ts';
import { RuntimeConfig } from '../../schema/config.ts';
import { fakeLlmHttp, toolCall } from '../helpers/fake-llm.ts';
import path from 'node:path';

const runtime = readJson(RuntimeConfig, path.join(PROJECT_ROOT, 'config/runtime.json'));

function client(responses: Parameters<typeof fakeLlmHttp>[0]) {
  const http = fakeLlmHttp(responses);
  const llm = createOpenAiCompatibleClient(http, {
    baseUrl: 'https://llm.example/v1',
    apiKey: 'k',
    sessionHeader: 'x-opencode-session',
    userAgent: 'IndieAtlasBot/0.1',
    model: () => ({ model: 'deepseek-v4.1-flash', thinking: 'enabled', maxOutputTokens: 1000 }),
    retries: 1,
    retryDelayMs: 0,
  });
  return { http, llm };
}

const echo: ToolSpec<{ q: string }> = {
  name: 'echo',
  description: 'echo',
  input: z.object({ q: z.string() }),
  run: async ({ q }) => ({ ok: true, content: `echo:${q}` }),
};
const Final = z.object({ answer: z.string().min(2) });

describe('runTools', () => {
  it('runs tools, keeps reasoning_content in the history, and returns the final value', async () => {
    const { http, llm } = client([toolCall('echo', { q: 'a' }), toolCall('submit', { answer: 'done' })]);
    const r = await llm.runTools!({
      role: 'execute',
      sessionId: 's',
      system: 'sys',
      prompt: 'p',
      tools: [echo],
      finalTool: { name: 'submit', description: 'submit', schema: Final },
      maxTurns: 5,
    });
    expect(r.stop).toBe('final');
    expect(r.value).toEqual({ answer: 'done' });
    const second = http.bodies[1]!.messages as { role: string; reasoning_content?: string; content: string }[];
    expect(second.find((m) => m.role === 'assistant')?.reasoning_content).toBe('think about echo');
    expect(second.at(-1)).toMatchObject({ role: 'tool', content: 'echo:a' });
    const tools = (http.bodies[0]!.tools as { function: { name: string } }[]).map((t) => t.function.name);
    expect(tools).toEqual(['echo', 'submit']);
  });

  it('returns validation errors for an invalid final input and accepts the corrected one', async () => {
    const { http, llm } = client([toolCall('submit', { answer: 'x' }), toolCall('submit', { answer: 'ok' })]);
    const r = await llm.runTools!({
      role: 'execute',
      sessionId: 's',
      system: 'sys',
      prompt: 'p',
      tools: [],
      finalTool: { name: 'submit', description: 'submit', schema: Final },
      maxTurns: 5,
    });
    expect(r.value).toEqual({ answer: 'ok' });
    const msgs = http.bodies[1]!.messages as { role: string; content: string }[];
    expect(msgs.at(-1)!.content).toContain('accepted":false');
  });

  it('stops with provider-limit when 429 continues after retries', async () => {
    const { llm } = client([{ status: 429 }, { status: 429 }]);
    const r = await llm.runTools!({
      role: 'execute',
      sessionId: 's',
      system: 'sys',
      prompt: 'p',
      tools: [],
      finalTool: { name: 'submit', description: 'submit', schema: Final },
      maxTurns: 5,
    });
    expect(r.stop).toBe('provider-limit');
  });

  it('does not call the LLM when the budget check refuses', async () => {
    const { http, llm } = client([]);
    const r = await llm.runTools!({
      role: 'execute',
      sessionId: 's',
      system: 'sys',
      prompt: 'p',
      tools: [],
      finalTool: { name: 'submit', description: 'submit', schema: Final },
      maxTurns: 5,
      beforeTurn: () => false,
    });
    expect(r.stop).toBe('budget');
    expect(http.bodies).toHaveLength(0);
  });

  it('nudges once at the turn limit and gives up after', async () => {
    const { llm } = client([toolCall('echo', { q: 'a' }), toolCall('echo', { q: 'b' })]);
    const r = await llm.runTools!({
      role: 'execute',
      sessionId: 's',
      system: 'sys',
      prompt: 'p',
      tools: [echo],
      finalTool: { name: 'submit', description: 'submit', schema: Final },
      maxTurns: 1,
    });
    expect(r.stop).toBe('max-turns');
  });
});

describe('pricing', () => {
  it('detects peak hours on weekdays only', () => {
    expect(isPeak(runtime.llm, '2026-11-04T02:00:00Z')).toBe(true); // 水曜 11時（日本時間）
    expect(isPeak(runtime.llm, '2026-11-04T00:17:00Z')).toBe(false);
    expect(isPeak(runtime.llm, '2026-11-07T02:00:00Z')).toBe(false); // 土曜
  });

  it('uses the allowance reported by OpenCode Go, otherwise the token prices', () => {
    const base = { model: 'deepseek-v4.1-flash', startedAt: '2026-11-04T00:17:00Z', reasoningTokens: 0 };
    expect(
      costOf(runtime.llm, { ...base, promptTokens: 1, completionTokens: 1, cachedTokens: 0, allowanceUsd: 0.5 }),
    ).toBe(0.5);
    const c = costOf(runtime.llm, {
      ...base,
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
      cachedTokens: 500_000,
    });
    expect(c).toBeCloseTo(0.5 * 0.15 + 0.5 * 0.003 + 0.6, 6);
  });
});

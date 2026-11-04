import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UsageLedger } from '../../schema/state.ts';
import { loadRepo, readJson, repoPath } from '../../scripts/lib/repo-io.ts';
import { createFakeLlm } from '../../scripts/llm/client.ts';
import { meteredLlm, recordUsage } from '../../scripts/pipeline/usage-ledger.ts';
import { z } from 'zod';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-usage-'));
  fs.cpSync(path.resolve('tests/fixtures/repo'), dir, { recursive: true });
  process.env.INDIEATLAS_ROOT = dir;
});
afterEach(() => {
  delete process.env.INDIEATLAS_ROOT;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('費用の台帳', () => {
  it('毎日の更新と週次の要約を同じ月の台帳に足し、同じ実行の同じ種類は置き換える', () => {
    const at = '2026-11-02T00:00:00Z';
    recordUsage({ runId: '100', runAttempt: 1, kind: 'update', at, llmUsd: 0.2 });
    recordUsage({ runId: '200', runAttempt: 1, kind: 'reviews', at, llmUsd: 0.05 });
    recordUsage({ runId: '200', runAttempt: 1, kind: 'reactions', at, llmUsd: 0.01 });
    recordUsage({ runId: '200', runAttempt: 1, kind: 'reviews', at, llmUsd: 0.06 });
    const ledger = readJson(UsageLedger, repoPath('state/usage/2026-11.json'));
    expect(ledger.entries.map((e) => `${e.runId}:${e.kind ?? 'update'}:${e.llmUsd}`)).toEqual([
      '100:update:0.2',
      '200:reactions:0.01',
      '200:reviews:0.06',
    ]);
    expect(ledger.totalUsd).toBe(0.27);
  });

  it('使わなかった実行は記録しない', () => {
    recordUsage({ runId: '300', runAttempt: 1, kind: 'reviews', at: '2026-11-02T00:00:00Z', llmUsd: 0 });
    expect(fs.existsSync(repoPath('state/usage/2026-11.json'))).toBe(false);
  });

  it('呼び出しごとの利用額を数える', async () => {
    const inner = createFakeLlm([{ ok: true }]);
    const usage = {
      model: 'deepseek-v4.1-flash',
      startedAt: '2026-11-02T00:00:00Z',
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
      allowanceUsd: 0.003,
    };
    const llm = meteredLlm(
      { generateObject: async (req) => (req.onUsage?.(usage), inner.generateObject(req)) },
      loadRepo().runtime,
    );
    await llm.generateObject({
      role: 'triage',
      sessionId: 's',
      system: '',
      prompt: '',
      schema: z.object({ ok: z.boolean() }),
    });
    expect(llm.total()).toBe(0.003);
  });
});

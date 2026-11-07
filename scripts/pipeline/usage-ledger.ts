import { UsageLedger } from '../../schema/state.ts';
import type { RuntimeConfig } from '../../schema/config.ts';
import { monthJst } from '../lib/clock.ts';
import { fileKind, readJsonIfExists, repoPath, writeKind } from '../lib/repo-io.ts';
import type { LlmClient } from '../llm/client.ts';
import { costOf } from '../llm/pricing.ts';

/** 費用の台帳（state/usage/{月}.json）。毎日の更新と週次の要約の利用額を同じ台帳に足す（06 §6.5.4） */

export type UsageKind = 'update' | 'reviews' | 'reactions' | 'titles';

export function recordUsage(entry: {
  runId: string;
  runAttempt: number;
  kind: UsageKind;
  at: string;
  llmUsd: number;
}): void {
  if (entry.llmUsd <= 0) return;
  const month = monthJst(new Date(entry.at));
  const f = repoPath(`state/usage/${month}.json`);
  const ledger = readJsonIfExists(UsageLedger, f) ?? { schemaVersion: 1 as const, month, entries: [] };
  const same = (e: UsageLedger['entries'][number]) =>
    e.runId === entry.runId && e.runAttempt === entry.runAttempt && (e.kind ?? 'update') === entry.kind;
  const { kind, ...rest } = entry;
  const next = { ...rest, ...(kind === 'update' ? {} : { kind }), llmUsd: Math.round(entry.llmUsd * 1e6) / 1e6 };
  ledger.entries = [...ledger.entries.filter((e) => !same(e)), next];
  writeKind(fileKind('usage'), f, {
    ...ledger,
    totalUsd: Math.round(ledger.entries.reduce((a, e) => a + e.llmUsd, 0) * 1e6) / 1e6,
  });
}

/** 呼び出しごとの利用額を数える LLM の接続。total() でこれまでの合計を返す */
export function meteredLlm(llm: LlmClient, runtime: RuntimeConfig): LlmClient & { total(): number } {
  let total = 0;
  return {
    total: () => total,
    generateObject: (req) =>
      llm.generateObject({
        ...req,
        onUsage: (u) => {
          total += costOf(runtime.llm, u);
          req.onUsage?.(u);
        },
      }),
  };
}

/** GitHub Actions では実行の ID、手元では local-{kind}-{日付} */
export function usageRunId(kind: UsageKind, at: string): { runId: string; runAttempt: number } {
  const id = process.env.GITHUB_RUN_ID;
  return id
    ? { runId: id, runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT || 1) }
    : { runId: `local-${kind}-${at.slice(0, 10)}`, runAttempt: 1 };
}

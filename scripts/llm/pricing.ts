import type { RuntimeConfig } from '../../schema/config.ts';
import type { LlmUsage } from './client.ts';

type Llm = RuntimeConfig['llm'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** リクエストの開始時刻（UTC）がピークの時間帯か（06 §6.9.3） */
export function isPeak(llm: Llm, startedAt: string): boolean {
  const d = new Date(startedAt);
  if (!llm.peakHoursUtc.days.includes(DAYS[d.getUTCDay()]!)) return false;
  const hm = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return llm.peakHoursUtc.ranges.some(([from, to]) => hm >= from && hm < to);
}

/** 単価表にないモデルは、単価表の最も高い単価で見積もる */
export function ratesFor(llm: Llm, model: string, startedAt: string) {
  const table = llm.pricingUsdPerMTok[model];
  const peak = isPeak(llm, startedAt);
  if (table) return { ...(peak ? table.peak : table.offPeak), known: true };
  const all = Object.values(llm.pricingUsdPerMTok).flatMap((t) => [t.peak, t.offPeak]);
  return {
    input: Math.max(0, ...all.map((p) => p.input)),
    output: Math.max(0, ...all.map((p) => p.output)),
    cacheRead: Math.max(0, ...all.map((p) => p.cacheRead)),
    known: false,
  };
}

/**
 * 1回の呼び出しの利用額（USD）。OpenCode Go が利用額（usage.opencode.allowance）を返したらそれを使い、
 * なければトークン数と単価から計算する（06 §6.9.3）
 */
export function costOf(llm: Llm, u: LlmUsage): number {
  if (typeof u.allowanceUsd === 'number') return u.allowanceUsd;
  const r = ratesFor(llm, u.model, u.startedAt);
  const uncached = Math.max(0, u.promptTokens - u.cachedTokens);
  return (uncached * r.input + u.cachedTokens * r.cacheRead + u.completionTokens * r.output) / 1_000_000;
}

import { z } from 'zod';
import type { RuntimeConfig } from '../../schema/config.ts';
import { NewTask } from '../../schema/proposal.ts';
import type { Task } from '../../schema/state.ts';
import type { LlmClient, LlmUsage } from '../llm/client.ts';
import { orderForExecution, type Selection } from './tasks.ts';

/** 調査の計画（06 §6.5.2、R4）。LLM の出力をコードで検証し、合わなければ baseline を使う */

export const PlanOutput = z.object({
  selected: z.array(z.object({ taskId: z.string(), why: z.string().max(120) })).max(30),
  newTasks: z.array(NewTask).max(5),
  notes: z.string().max(500),
});
export type PlanOutput = z.infer<typeof PlanOutput>;

const STAGE1 = new Set(['fix-conflict', 'fix-duplicate', 'fix-reported-error']);

export interface PlanResult {
  source: 'llm' | 'baseline';
  selected: Task[];
  why: Map<string, string>;
  newTasks: z.infer<typeof NewTask>[];
  notes: string;
}

/** LLM の選択を、制約（段階1、探索枠、作品ごとの上限、枠の数、順番）に合わせて直す */
export function correctPlan(out: PlanOutput, baseline: Selection, runtime: RuntimeConfig, slots: number): Task[] {
  const byId = new Map(baseline.candidates.map((t) => [t.id, t]));
  for (const t of baseline.selected) byId.set(t.id, t);
  let chosen = out.selected.map((s) => byId.get(s.taskId)).filter((t): t is Task => !!t);
  chosen = [...new Map(chosen.map((t) => [t.id, t])).values()];
  // baseline の段階1は外せない
  for (const t of baseline.selected.filter((x) => STAGE1.has(x.type)).reverse())
    if (!chosen.includes(t)) chosen.unshift(t);
  // 探索の枠
  const need = Math.ceil(slots * runtime.exploration.minTaskShare);
  const have = chosen.filter((t) => baseline.exploration.has(t.id)).length;
  if (have < need) {
    for (const t of baseline.selected
      .filter((x) => baseline.exploration.has(x.id) && !chosen.includes(x))
      .slice(0, need - have))
      chosen.push(t);
  }
  // 作品ごとの上限と枠の数（超えた分は末尾から外す）
  const perGame = new Map<string, number>();
  const kept: Task[] = [];
  for (const t of chosen) {
    const g = t.target.gameId;
    if (g && (perGame.get(g) ?? 0) >= runtime.run.maxTasksPerGame) continue;
    if (g) perGame.set(g, (perGame.get(g) ?? 0) + 1);
    kept.push(t);
  }
  while (kept.length > slots) {
    const i = kept.findLastIndex((t) => !STAGE1.has(t.type) && !baseline.exploration.has(t.id));
    kept.splice(i >= 0 ? i : kept.length - 1, 1);
  }
  return orderForExecution(kept, baseline.exploration);
}

export async function planTasks(
  llm: LlmClient | undefined,
  baseline: Selection,
  opts: {
    runtime: RuntimeConfig;
    slots: number;
    system: string;
    runId: string;
    siteState: Record<string, unknown>;
    previousNotes?: string;
    onUsage?: (u: LlmUsage, sessionId: string) => void;
    canCall?: () => boolean;
    log?: (line: string) => void;
  },
): Promise<PlanResult> {
  const fallback: PlanResult = {
    source: 'baseline',
    selected: baseline.selected,
    why: new Map(),
    newTasks: [],
    notes: opts.previousNotes ?? '',
  };
  // 候補が枠より少なければ、計画するまでもない
  if (!llm || baseline.candidates.length <= baseline.selected.length || !(opts.canCall?.() ?? true)) return fallback;
  const sessionId = `ia-${opts.runId}-plan`;
  try {
    const out = await llm.generateObject({
      role: 'plan',
      sessionId,
      system: opts.system,
      prompt: JSON.stringify({
        siteState: opts.siteState,
        constraints: {
          slots: opts.slots,
          explorationSlots: Math.ceil(opts.slots * opts.runtime.exploration.minTaskShare),
          maxTasksPerGame: opts.runtime.run.maxTasksPerGame,
          stage1MustStay: true,
        },
        baseline: baseline.selected.map((t) => t.id),
        candidates: baseline.candidates.map((t) => ({
          taskId: t.id,
          type: t.type,
          goal: t.goal,
          target: {
            gameId: t.target.gameId,
            url: t.target.url,
            name: t.target.name,
            hints: t.target.hints?.slice(0, 3),
          },
          priority: t.priority,
          inBaseline: baseline.selected.some((x) => x.id === t.id),
          exploration: baseline.exploration.has(t.id),
        })),
        previousNotes: opts.previousNotes ?? '',
      }),
      schema: PlanOutput,
      onUsage: (u) => opts.onUsage?.(u, sessionId),
    });
    const selected = correctPlan(out, baseline, opts.runtime, opts.slots);
    if (selected.length === 0) return fallback;
    return {
      source: 'llm',
      selected,
      why: new Map(out.selected.map((s) => [s.taskId, s.why])),
      newTasks: out.newTasks,
      notes: out.notes,
    };
  } catch (e) {
    opts.log?.(`plan: ${(e as Error).message}（baseline を使う）`);
    return fallback;
  }
}

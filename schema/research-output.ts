import { z } from 'zod';
import { ArticleKind, HttpUrl, IsoDateTime, RunId, Sha256, SourceId, TaskId } from './common.ts';
import { SourceState, Task } from './state.ts';
import { TaskResult } from './proposal.ts';

/** 調査ジョブの出力（out/。06 §6.2）。採用ジョブはこれだけを読む */

export const ResearchMeta = z.object({
  schemaVersion: z.literal(1),
  runId: RunId,
  runAttempt: z.number().int().min(1),
  trigger: z.enum(['schedule', 'workflow_dispatch', 'push', 'local']),
  mode: z.enum(['full', 'collect-only']),
  startedAt: IsoDateTime,
  finishedAt: IsoDateTime.optional(), // 異常終了したら書かれない
  triggerCommit: z.string().regex(/^[0-9a-f]{40}$/),
  stopReason: z.enum([
    'completed',
    'soft-deadline',
    'hard-deadline',
    'cost-budget',
    'provider-limit',
    'error',
    'llm-disabled',
  ]),
  notes: z.string().max(500).optional(), // 計画の所見。次回の計画に渡す
  pending: z.array(z.string().max(200)).max(20),
});
export type ResearchMeta = z.infer<typeof ResearchMeta>;

export const TaskUpdates = z.object({
  schemaVersion: z.literal(1),
  newTasks: z.array(Task),
  // 既存のタスクの状態の変化（R1 で blocked から open に戻したもの）
  reopened: z.array(TaskId),
  // この実行で結果のなかったタスク（費用や時間の上限、失敗）
  attempts: z.array(z.object({ taskId: TaskId, outcome: z.enum(['failed', 'deferred']), note: z.string().max(300) })),
});
export type TaskUpdates = z.infer<typeof TaskUpdates>;

export const CollectedItem = z.object({
  itemKey: z.string().min(1).max(300),
  sourceId: SourceId,
  url: HttpUrl,
  title: z.string().max(400),
  publishedAt: IsoDateTime.optional(),
  description: z.string().max(400).optional(),
  categories: z.array(z.string().max(80)).max(20),
  triage: z
    .object({
      relevant: z.enum(['yes', 'no', 'maybe']),
      mentionedGames: z.array(z.string().max(120)).max(10),
      kindGuess: ArticleKind,
      reason: z.string().max(60),
    })
    .optional(),
  taskId: TaskId.optional(), // 作った process-article タスク
});
export type CollectedItem = z.infer<typeof CollectedItem>;
export const Collected = z.object({ schemaVersion: z.literal(1), items: z.array(CollectedItem) });
export type Collected = z.infer<typeof Collected>;

export const SourceUpdate = z.object({
  sourceId: SourceId,
  ok: z.boolean(),
  state: SourceState, // 反映する新しい状態
  itemsFetched: z.number().int().min(0),
  itemsTaken: z.number().int().min(0),
  error: z.string().max(500).optional(),
});
export const SourceUpdates = z.object({ schemaVersion: z.literal(1), updates: z.array(SourceUpdate) });
export type SourceUpdates = z.infer<typeof SourceUpdates>;

export const PlanFile = z.object({
  schemaVersion: z.literal(1),
  source: z.enum(['llm', 'baseline']),
  selected: z.array(z.object({ taskId: TaskId, why: z.string().max(120), exploration: z.boolean() })),
  notes: z.string().max(500),
});
export type PlanFile = z.infer<typeof PlanFile>;

/** out/task-results.jsonl の1行 */
export const TaskResultLine = z.object({
  taskId: TaskId,
  taskType: Task.shape.type,
  finishedAt: IsoDateTime,
  stop: z.enum(['final', 'max-turns', 'budget', 'deadline', 'refusal', 'provider-limit', 'error']),
  costUsd: z.number(),
  result: TaskResult,
});
export type TaskResultLine = z.infer<typeof TaskResultLine>;

/** 取得ログ（out/fetch-log/{fetchId}.json）。採用ジョブは根拠の検証にこれを使う */
export const FetchLogEntry = z.object({
  schemaVersion: z.literal(1),
  fetchId: z.string().regex(/^f_\d{4,6}$/),
  taskId: TaskId.optional(),
  tool: z.enum(['fetch_url', 'get_steam_app']),
  url: HttpUrl,
  finalUrl: HttpUrl,
  status: z.number().int(),
  retrievedAt: IsoDateTime,
  contentType: z.string().max(200),
  fetchHash: Sha256.optional(),
  title: z.string().max(400).optional(),
  canonicalUrl: HttpUrl.optional(),
  publishedAt: IsoDateTime.optional(),
  lang: z.string().max(20).optional(),
  text: z.string(), // 抽出した本文（Git には入れない）
  noai: z.boolean(),
  blocked: z.string().max(40).optional(),
  // get_steam_app のときは、整形した項目（locator の照合に使う）
  steam: z.record(z.string(), z.unknown()).optional(),
});
export type FetchLogEntry = z.infer<typeof FetchLogEntry>;

export const UsageEntry = z.object({
  role: z.enum(['triage', 'plan', 'execute', 'resolve']),
  sessionId: z.string().max(200),
  taskId: TaskId.optional(),
  model: z.string(),
  startedAt: IsoDateTime,
  inputTokens: z.number().int().min(0),
  cachedInputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  reasoningTokens: z.number().int().min(0),
  costUsd: z.number().min(0),
});
export type UsageEntry = z.infer<typeof UsageEntry>;
export const UsageFile = z.object({
  schemaVersion: z.literal(1),
  calls: z.array(UsageEntry),
  totalUsd: z.number().min(0),
});
export type UsageFile = z.infer<typeof UsageFile>;

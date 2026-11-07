import { z } from 'zod';
import { ClaimField } from './claim.ts';
import { EventId } from './event.ts';
import {
  ArticleId,
  ClaimId,
  CollectionId,
  GameId,
  HttpUrl,
  IsoDate,
  IsoDateTime,
  ReviewId,
  RunId,
  Sha256,
  SourceId,
  TaskId,
} from './common.ts';

export const SourceState = z.object({
  schemaVersion: z.literal(1),
  sourceId: SourceId,
  cursor: z.object({
    lastItemPublishedAt: IsoDateTime.optional(),
    recentItemKeys: z.array(z.string()).max(500), // 直近に処理した項目の guid、または正規化 URL のハッシュ
    etag: z.string().max(200).optional(),
    lastModified: z.string().max(100).optional(),
  }),
  lastAttemptAt: IsoDateTime.optional(),
  lastSuccessAt: IsoDateTime.optional(),
  consecutiveFailures: z.number().int().min(0),
  lastError: z.object({ at: IsoDateTime, message: z.string().max(500) }).optional(),
  nextAttemptAfter: IsoDateTime.optional(),
});
export type SourceState = z.infer<typeof SourceState>;

export const TaskType = z.enum([
  'fix-conflict',
  'fix-duplicate',
  'fix-reported-error', // 段階1: 誤情報と重複の修正
  'check-change',
  'process-article', // 段階2: 変化の確認、新着記事の処理
  'register-game',
  'discover', // 段階3: 未登録作品の登録と探索
  'fill-missing',
  'refresh-game', // 段階4: 不足情報の補完と再確認
  'improve-relations',
  'improve-collection',
  'review-tags', // 段階5: 関連作品、コレクション、分類の改善
  'register-event',
  'check-event', // 催しの登録と日程の確認（06 §6.13.1）
]);
export type TaskType = z.infer<typeof TaskType>;
export const TaskOutcome = z.enum(['completed', 'partial', 'not-found', 'blocked', 'irrelevant', 'failed', 'deferred']);

export const Task = z.object({
  id: TaskId,
  type: TaskType,
  target: z
    .object({
      gameId: GameId.optional(),
      articleId: ArticleId.optional(),
      url: HttpUrl.optional(),
      sourceId: SourceId.optional(),
      collectionId: CollectionId.optional(),
      eventId: EventId.optional(),
      field: ClaimField.optional(),
      claimIds: z.array(ClaimId).max(10).optional(),
      name: z.string().max(120).optional(), // 未登録作品の名前など
      hints: z.array(z.string().max(200)).max(10).optional(),
    })
    .strict(),
  goal: z.string().min(5).max(300), // 調査の目的（日本語）
  status: z.enum(['open', 'blocked', 'done', 'dropped']),
  priority: z.number(), // 最後に計算した優先度（参考値）
  attempts: z.number().int().min(0),
  lastAttemptAt: IsoDateTime.optional(),
  lastRunId: RunId.optional(),
  blockedReason: z.string().max(300).optional(),
  recheck: z.object({ after: IsoDate.optional(), condition: z.string().max(200).optional() }).optional(),
  createdAt: IsoDateTime,
  createdBy: z.enum(['collector', 'planner', 'executor', 'validator', 'scheduler', 'human', 'agent']),
  resolution: z
    .object({ at: IsoDateTime, runId: RunId, outcome: TaskOutcome, summary: z.string().max(300) })
    .optional(),
});
export type Task = z.infer<typeof Task>;

export const TasksFile = z.object({ schemaVersion: z.literal(1), tasks: z.array(Task) }); // id の順
export type TasksFile = z.infer<typeof TasksFile>;

export const SeenUrls = z.object({
  schemaVersion: z.literal(1),
  entries: z.record(
    z.string().regex(/^[0-9a-f]{16}$/), // 正規化した URL の sha256 の先頭16桁
    z.object({
      status: z.enum(['article', 'task', 'irrelevant', 'failed']),
      articleId: ArticleId.optional(),
      taskId: TaskId.optional(),
      sourceId: SourceId.optional(),
      attempts: z.number().int().min(0),
      firstSeenAt: IsoDate,
      lastSeenAt: IsoDate,
    }),
  ),
});
export type SeenUrls = z.infer<typeof SeenUrls>;

/**
 * 06 §6.6 の Operation。提案のスキーマ（schema/proposal.ts）は第2段階（P2-06）で実装する。
 * それまでは形式を問わず保存し、kind ごとの検証は行わない。
 */
export const Operation = z.record(z.string(), z.unknown());

export const ReviewItem = z.object({
  id: ReviewId,
  kind: z.enum(['merge-games', 'developer-independence', 'core-tag-change', 'collection-publish', 'other']),
  operation: Operation, // 06 §6.6 の Operation をそのまま保存する
  reason: z.string().max(500),
  createdAt: IsoDateTime,
  createdByRun: RunId,
  status: z.enum(['open', 'accepted', 'rejected', 'applied']),
  decidedAt: IsoDateTime.optional(),
  note: z.string().max(500).optional(),
});
export type ReviewItem = z.infer<typeof ReviewItem>;
export const ReviewQueue = z.object({ schemaVersion: z.literal(1), items: z.array(ReviewItem) });
export type ReviewQueue = z.infer<typeof ReviewQueue>;

const Count = z.number().int();

export const RunSummary = z.object({
  runId: RunId,
  runAttempt: z.number().int().min(1),
  researchAttempt: z.number().int().min(1).optional(), // 採用した調査結果の試行番号
  trigger: z.enum(['schedule', 'workflow_dispatch', 'push', 'local']),
  mode: z.enum(['full', 'collect-only', 'publish-only', 'manual']), // manual: npm run ia -- apply（12）
  startedAt: IsoDateTime,
  finishedAt: IsoDateTime,
  triggerCommit: z.string().regex(/^[0-9a-f]{40}$/),
  dataCommit: z
    .string()
    .regex(/^[0-9a-f]{40}$/)
    .optional(),
  outcome: z.enum(['success', 'partial', 'no-change', 'failed']),
  stopReason: z.enum([
    'completed',
    'soft-deadline',
    'hard-deadline',
    'cost-budget',
    'provider-limit',
    'error',
    'llm-disabled',
  ]),
  counts: z.object({
    sourcesFetched: Count,
    sourcesFailed: Count,
    articlesCollected: Count,
    articlesLinked: Count,
    gamesCreated: Count,
    gamesPublished: Count,
    claimsAdded: Count,
    claimsAdopted: Count,
    claimsConflicted: Count,
    relationsAdded: Count,
    collectionsChanged: Count,
    tasksCreated: Count,
    tasksDone: Count,
    tasksBlocked: Count,
    operationsRejected: Count,
  }),
  cost: z.object({
    llmUsd: z.number(),
    inputTokens: Count,
    outputTokens: Count,
    cachedInputTokens: Count,
    reasoningTokens: Count,
  }),
  publish: z.object({
    status: z.enum(['pending', 'deployed', 'skipped-unchanged', 'failed', 'unknown']),
    contentHash: Sha256.optional(),
  }),
  pending: z.array(z.string().max(200)).max(20), // 保留事項の要約
  rejections: z.array(z.object({ rule: z.string(), count: Count })).max(50),
});
export type RunSummary = z.infer<typeof RunSummary>;
export const RunsFile = z.object({ schemaVersion: z.literal(1), runs: z.array(RunSummary) }); // startedAt の順
export type RunsFile = z.infer<typeof RunsFile>;

export const UsageLedger = z.object({
  schemaVersion: z.literal(1),
  month: z.string().regex(/^\d{4}-\d{2}$/), // 日本時間の暦月
  entries: z.array(
    z.object({
      runId: RunId,
      runAttempt: z.number().int(),
      // 何に使ったか。省略は毎日の更新（update.yml の調査）。reviews と reactions は週次の要約（06 §6.13.6、§6.13.7）
      kind: z.enum(['update', 'reviews', 'reactions', 'titles']).optional(),
      at: IsoDateTime,
      llmUsd: z.number(),
    }),
  ),
  totalUsd: z.number(),
});
export type UsageLedger = z.infer<typeof UsageLedger>;

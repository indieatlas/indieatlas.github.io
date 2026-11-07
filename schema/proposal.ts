import { z } from 'zod';
import { CLAIM_VALUES, ClaimBasis, ClaimScope, type ClaimField } from './claim.ts';
import { Collection } from './collection.ts';
import {
  ArticleKind,
  ArticleRole,
  ClaimId,
  CollectionId,
  DeveloperId,
  GameId,
  HttpUrl,
  IsoDate,
  IsoDateTime,
  Lang,
  PartialDate,
  RelationKind,
  TagId,
} from './common.ts';
import { Developer } from './developer.ts';
import { EventId, EventKind } from './event.ts';
import { Alias, ExternalIds, AssociatedApp, IdentityEvidence, ProposableIndieReasonCode } from './game.ts';
import { Task, TaskType } from './state.ts';
import { Tag } from './taxonomy.ts';

/**
 * 調査ジョブ（LLM）が出力する提案（06 §6.6）。LLM は ID の数字を割り当てない。
 * 新しい作品は `new:1` のような一時 ID で指す。根拠の取得日時、本文のハッシュ、根拠の種類、originKey は、
 * 取得ログからコードが補う。
 */

export const TempId = z.string().regex(/^new:\d{1,2}$/);

export const GameRef = z.union([
  z.object({ gameId: GameId }).strict(),
  z.object({ tempId: TempId }).strict(), // 同じ TaskResult の create-game を指す
]);
export type GameRef = z.infer<typeof GameRef>;

export const DeveloperRef = z.union([
  z.object({ developerId: DeveloperId }).strict(),
  z.object({ name: z.string().min(1).max(80), officialUrl: HttpUrl.optional() }).strict(), // コードが既存と照合し、なければ作る
]);
export type DeveloperRef = z.infer<typeof DeveloperRef>;

export const EvidenceDraft = z
  .object({
    url: HttpUrl, // fetch_url または get_steam_app で取得した URL
    quote: z.string().min(8).max(200).optional(), // 取得した本文にそのまま含まれる文
    locator: z.string().max(200).optional(), // get_steam_app の項目
    publishedAt: z.union([IsoDateTime, IsoDate]).optional(),
  })
  .refine((e) => e.quote || e.locator, { message: 'quote or locator required' });
export type EvidenceDraft = z.infer<typeof EvidenceDraft>;

export const ArticleDraft = z.object({
  url: HttpUrl,
  title: z.string().min(1).max(300),
  titleJa: z.string().max(150).optional(), // 日本語以外の記事だけ。タイトルを日本語に訳したもの
  outletName: z.string().min(1).max(80),
  lang: Lang,
  kind: ArticleKind,
  publishedAt: IsoDateTime.optional(),
  summaryJa: z.string().max(120).optional(),
  derivedFrom: z.object({ key: z.string().min(3).max(200), url: HttpUrl.optional() }).optional(),
  games: z.array(z.object({ ref: GameRef, role: ArticleRole, note: z.string().max(80).optional() })).max(30),
});
export type ArticleDraft = z.infer<typeof ArticleDraft>;

export const IndieReasonDraft = z.object({
  code: ProposableIndieReasonCode,
  note: z.string().max(200).optional(),
  evidence: z.array(EvidenceDraft).min(1).max(5),
});
export type IndieReasonDraft = z.infer<typeof IndieReasonDraft>;

export const GameTitle = z.object({
  display: z.string().min(1).max(120),
  original: z.string().min(1).max(120),
  originalLang: Lang,
});

export const GameIdentityDraft = z.object({
  title: GameTitle,
  aliases: z.array(Alias).max(30),
  externalIds: ExternalIds,
  associatedApps: z.array(AssociatedApp).max(30),
  officialUrl: HttpUrl.optional(),
  developers: z.array(DeveloperRef).max(10),
  publishers: z.array(DeveloperRef).max(10),
  evidence: z
    .array(z.object({ field: IdentityEvidence.shape.field, evidence: EvidenceDraft }))
    .min(1)
    .max(20),
  indieReasons: z.array(IndieReasonDraft).max(10),
});
export type GameIdentityDraft = z.infer<typeof GameIdentityDraft>;

function claimDraftOf<F extends ClaimField>(field: F) {
  return z.object({
    field: z.literal(field),
    scope: ClaimScope,
    value: CLAIM_VALUES[field],
    basis: ClaimBasis,
    asOf: IsoDate, // 情報の時点。出典がその情報を示した日
    evidence: z.array(EvidenceDraft).min(1).max(10),
    supersedes: z.array(ClaimId).max(10).optional(), // 延期の告知など、明示的に置き換える Claim
  });
}

/** Claim から ID、状態、日時、作り手を除き、根拠を EvidenceDraft にしたもの */
export const ClaimDraft = z.discriminatedUnion('field', [
  claimDraftOf('release'),
  claimDraftOf('japaneseSupport'),
  claimDraftOf('playerModes'),
  claimDraftOf('summary'),
  claimDraftOf('features'),
  claimDraftOf('overview'),
  claimDraftOf('tag'),
  claimDraftOf('storeLink'),
  claimDraftOf('image'),
]);
export type ClaimDraft = z.infer<typeof ClaimDraft>;

/** 催しの提案（06 §6.13.1） */
export const EventDraft = z.object({
  name: z.string().min(1).max(120),
  nameEn: z.string().max(120).optional(),
  aliases: z.array(z.string().min(2).max(60)).max(8).optional(), // 略称など（例: ゲムダン14）
  kind: EventKind,
  format: z.enum(['in-person', 'online', 'hybrid']),
  status: z.enum(['scheduled', 'tentative', 'cancelled']),
  start: PartialDate, // 日本時間の暦日
  end: PartialDate.optional(),
  time: z.string().max(40).optional(),
  location: z
    .object({
      venue: z.string().max(120),
      city: z.string().max(60).optional(),
      country: z
        .string()
        .regex(/^[A-Z]{2}$/)
        .optional(),
    })
    .optional(),
  url: HttpUrl, // 案内のページ
  summary: z.string().min(20).max(160),
  games: z.array(GameRef).max(60),
  evidence: z.array(EvidenceDraft).min(1).max(5),
});
export type EventDraft = z.infer<typeof EventDraft>;

const IdentityChanges = z
  .object({
    addAliases: z.array(Alias).max(10).optional(),
    setExternalIds: ExternalIds.optional(), // 未設定の項目だけ設定できる（V-I04）
    addAssociatedApps: z.array(AssociatedApp).max(30).optional(),
    setOfficialUrl: HttpUrl.optional(),
    addDevelopers: z.array(DeveloperRef).max(5).optional(),
    addPublishers: z.array(DeveloperRef).max(5).optional(),
    setTitle: GameTitle.optional(),
    addIndieReasons: z.array(IndieReasonDraft).max(5).optional(),
  })
  .strict();

export const Operation = z.discriminatedUnion('op', [
  z.object({ op: z.literal('upsert-article'), article: ArticleDraft }),
  z.object({ op: z.literal('create-game'), tempId: TempId, identity: GameIdentityDraft }),
  z.object({
    op: z.literal('update-identity'),
    game: GameRef,
    changes: IdentityChanges,
    evidence: z.array(EvidenceDraft).min(1).max(10),
  }),
  z.object({
    op: z.literal('add-claim'),
    game: GameRef,
    claim: ClaimDraft,
    replace: z
      .object({
        // summary と features の置き換えのときだけ
        reason: z.enum(['new-facts', 'current-invalid']),
        basedOnClaimIds: z.array(ClaimId).max(10),
      })
      .optional(),
  }),
  z.object({ op: z.literal('confirm-claim'), claimId: ClaimId, evidence: z.array(EvidenceDraft).min(1).max(5) }),
  z.object({
    op: z.literal('retract-claim'),
    claimId: ClaimId,
    reason: z.string().min(10).max(200),
    evidence: z.array(EvidenceDraft).min(1).max(5),
  }),
  z.object({
    op: z.literal('add-relation'),
    a: GameRef,
    b: GameRef,
    kind: RelationKind,
    reason: z.string().min(10).max(100),
    evidenceClaimIds: z.array(ClaimId).max(10),
    evidence: z.array(EvidenceDraft).max(5),
  }),
  z.object({
    op: z.literal('collection-add'),
    collectionId: CollectionId,
    game: GameRef,
    reason: z.string().min(20).max(120),
    evidenceClaimIds: z.array(ClaimId).min(1).max(5),
  }),
  z.object({
    op: z.literal('collection-remove'),
    collectionId: CollectionId,
    gameId: GameId,
    reason: z.string().min(10).max(200),
  }),
  z.object({
    op: z.literal('create-collection-draft'),
    draft: Collection.pick({ title: true, lede: true, description: true, criteria: true }),
    items: z
      .array(
        z.object({
          gameId: GameId,
          reason: z.string().min(20).max(120),
          evidenceClaimIds: z.array(ClaimId).min(1).max(5),
        }),
      )
      .min(4)
      .max(30),
  }),
  z.object({
    op: z.literal('propose-tag'),
    tag: Tag.pick({ id: true, label: true, aliases: true, group: true, definition: true }),
  }),
  z.object({
    op: z.literal('propose-tag-change'),
    change: z.enum(['merge', 'promote-to-core', 'edit-definition']),
    tagIds: z.array(TagId).min(1).max(5),
    detail: z.string().max(300),
  }),
  z.object({
    op: z.literal('propose-merge'),
    gameIds: z.tuple([GameId, GameId]),
    keep: GameId,
    reason: z.string().max(300),
    evidence: z.array(EvidenceDraft).min(1).max(5),
  }),
  z.object({
    op: z.literal('upsert-developer'),
    developer: DeveloperRef,
    changes: z
      .object({
        addAliases: z.array(z.string().max(80)).max(10).optional(),
        setOfficialUrl: HttpUrl.optional(),
        addLinks: Developer.shape.links.optional(),
        proposeIndependence: z.enum(['independent', 'affiliated', 'major', 'unknown']).optional(),
      })
      .strict(),
    evidence: z.array(EvidenceDraft).min(1).max(5),
  }),
  z.object({
    op: z.literal('upsert-event'),
    event: EventDraft,
    replacesEventId: EventId.optional(), // 開始日が変わったときの、前の ID
  }),
]);
export type Operation = z.infer<typeof Operation>;
export type OperationKind = Operation['op'];

export const NewTask = z.object({
  type: TaskType.exclude(['fix-reported-error']),
  target: Task.shape.target,
  goal: z.string().min(5).max(300),
  reason: z.string().max(200),
});
export type NewTask = z.infer<typeof NewTask>;

export const TaskResultOutcome = z.enum(['completed', 'partial', 'not-found', 'blocked', 'irrelevant']);

export const TaskResult = z.object({
  taskId: z.string().regex(/^t_[0-9a-f]{16}$/),
  outcome: TaskResultOutcome,
  summary: z.string().min(1).max(300), // 何をして何が分かったか（日本語）
  operations: z.array(Operation).max(60),
  followUpTasks: z.array(NewTask).max(5),
  blockedReason: z.string().max(300).optional(),
  recheck: z.object({ after: IsoDate.optional(), condition: z.string().max(200).optional() }).optional(),
  injectionDetected: z.boolean(), // 取得したページに LLM への指示文があった
});
export type TaskResult = z.infer<typeof TaskResult>;

/** タスクの種類ごとに使ってよい操作（06 §6.5.3） */
export const ALLOWED_OPERATIONS: Record<TaskType, readonly OperationKind[]> = {
  'process-article': [
    'upsert-article',
    'create-game',
    'update-identity',
    'add-claim',
    'confirm-claim',
    'upsert-developer',
    'upsert-event',
  ],
  'register-game': ['create-game', 'update-identity', 'add-claim', 'upsert-article', 'upsert-developer'],
  discover: [],
  'check-change': ['add-claim', 'confirm-claim', 'retract-claim', 'upsert-article'],
  'fill-missing': ['add-claim', 'confirm-claim', 'update-identity'],
  'refresh-game': ['confirm-claim', 'add-claim', 'retract-claim', 'update-identity'],
  'fix-conflict': ['add-claim', 'confirm-claim', 'retract-claim'],
  'fix-duplicate': ['propose-merge', 'update-identity'],
  'fix-reported-error': ['add-claim', 'confirm-claim', 'retract-claim', 'update-identity', 'propose-merge'],
  'improve-relations': ['add-relation'],
  'improve-collection': ['collection-add', 'collection-remove', 'create-collection-draft'],
  'review-tags': ['add-claim', 'propose-tag', 'propose-tag-change'],
  'register-event': ['upsert-event'],
  'check-event': ['upsert-event'],
};

/** 「対象の作品だけ」を変更してよいタスク（V-S05） */
export const TARGET_ONLY_TASKS: readonly TaskType[] = [
  'check-change',
  'fill-missing',
  'refresh-game',
  'fix-conflict',
  'fix-duplicate',
  'fix-reported-error',
];

/** 非公開（hidden）の作品を変更してよい、修正の種類のタスク（V-S03） */
export const FIX_TASKS: readonly TaskType[] = ['fix-conflict', 'fix-duplicate', 'fix-reported-error'];

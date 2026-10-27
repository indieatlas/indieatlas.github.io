import { z } from 'zod';
import {
  Actor,
  ArticleId,
  ClaimId,
  EvidenceKind,
  GameId,
  HttpUrl,
  IsoDate,
  IsoDateTime,
  PartialDate,
  Platform,
  PlayerMode,
  Region,
  ReleaseStatus,
  RunId,
  Sha256,
  SourceId,
  Store,
  Support,
  TagId,
} from './common.ts';

export const Evidence = z
  .object({
    kind: EvidenceKind, // official、store、media、database、event
    url: HttpUrl,
    sourceId: SourceId.optional(), // config/sources.json に登録した情報源なら、その ID
    articleId: ArticleId.optional(), // kind=media のときは記事の ID
    publishedAt: z.union([IsoDateTime, IsoDate]).optional(), // 出典が公開、発表された日時
    retrievedAt: IsoDateTime, // 取得した日時（コードが取得ログから設定する）
    quote: z.string().min(8).max(200).optional(), // 根拠となる箇所の原文の抜粋。サイトには出さない
    quoteHash: Sha256.optional(), // evidence.storeQuotes=false のとき、抜粋の代わりに保存する
    locator: z.string().max(200).optional(), // API の項目など。例: "steam:appdetails.release_date.date"
    originKey: z.string().max(200), // 独立性を判定するキー（04 §4.5.3）
    fetchHash: Sha256.optional(), // 取得した本文のハッシュ
  })
  .superRefine((e, ctx) => {
    if (!e.quote && !e.quoteHash && !e.locator) {
      ctx.addIssue({ code: 'custom', message: 'quote, quoteHash or locator required' });
    }
  });
export type Evidence = z.infer<typeof Evidence>;

export const ClaimStatus = z.enum(['adopted', 'candidate', 'conflicted', 'superseded', 'rejected', 'retracted']);
export type ClaimStatus = z.infer<typeof ClaimStatus>;
export const ClaimBasis = z.enum(['fact', 'reported', 'editorial']); // 根拠のある事実、媒体による報道、編集上の解釈
export const ClaimField = z.enum([
  'release',
  'japaneseSupport',
  'playerModes',
  'summary',
  'features',
  'tag',
  'storeLink',
  'image',
]);
export type ClaimField = z.infer<typeof ClaimField>;
export const ClaimStatusReason = z.enum([
  'highest-rank',
  'newer-source',
  'higher-tier-source',
  'outranked',
  'conflict-same-rank',
  'insufficient-evidence',
  'paraphrase-only',
  'tag-limit',
  'retracted-by-evidence',
  'retracted-by-human',
  'source-disabled',
  'game-merged',
]);

const ClaimScope = z.object({ platform: Platform.optional(), region: Region.optional() }).strict();

const ClaimBase = z.object({
  id: ClaimId,
  gameId: GameId,
  scope: ClaimScope,
  basis: ClaimBasis,
  evidence: z.array(Evidence).min(1).max(20),
  asOf: IsoDate, // 情報の時点。出典がその情報を示した日（発表日など）
  status: ClaimStatus,
  statusReason: ClaimStatusReason.optional(),
  supersedes: z.array(ClaimId).max(10).optional(),
  supersededBy: ClaimId.optional(),
  adoptedAt: IsoDateTime.optional(), // adopted になった日時
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  lastCheckedAt: IsoDateTime, // 最後に出典で確認した日時。公開内容ハッシュの計算から除く
  createdBy: Actor,
  createdByRun: RunId,
});

export const ImageValue = z.object({
  url: HttpUrl,
  role: z.enum(['header', 'capsule', 'keyart', 'screenshot', 'logo']),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  alt: z.string().max(120).optional(),
  usage: z.object({
    basis: z.enum(['store-asset', 'official-press-kit', 'developer-provided', 'other-permitted']),
    credit: z.string().max(80).optional(),
    note: z.string().max(200).optional(),
  }),
});

export const ReleaseValue = z.object({
  status: ReleaseStatus,
  date: PartialDate.optional(), // released と early-access では必須。upcoming では任意
  rawText: z.string().max(60).optional(), // 出典の原文の表記。例: 「2027年春」「Q2 2027」
});
export const JapaneseSupportValue = z.object({ interface: Support, subtitles: Support, audio: Support });
export const PlayerModesValue = z.object({
  modes: z.array(PlayerMode).min(1),
  minPlayers: z.number().int().min(1).max(1000).optional(),
  maxPlayers: z.number().int().min(1).max(1000).optional(),
});

export const Claim = z.discriminatedUnion('field', [
  ClaimBase.extend({ field: z.literal('release'), value: ReleaseValue }),
  ClaimBase.extend({ field: z.literal('japaneseSupport'), value: JapaneseSupportValue }),
  ClaimBase.extend({ field: z.literal('playerModes'), value: PlayerModesValue }),
  ClaimBase.extend({ field: z.literal('summary'), value: z.object({ ja: z.string().min(60).max(160) }) }),
  ClaimBase.extend({
    field: z.literal('features'),
    value: z.object({ ja: z.array(z.string().min(10).max(60)).min(3).max(5) }),
  }),
  ClaimBase.extend({ field: z.literal('tag'), value: z.object({ tagId: TagId }) }),
  ClaimBase.extend({ field: z.literal('storeLink'), value: z.object({ store: Store, url: HttpUrl }) }),
  ClaimBase.extend({ field: z.literal('image'), value: ImageValue }),
]);
export type Claim = z.infer<typeof Claim>;
export type ClaimOf<F extends ClaimField> = Extract<Claim, { field: F }>;

export const ClaimsFile = z.object({
  schemaVersion: z.literal(1),
  gameId: GameId,
  claims: z.array(Claim),
});
export type ClaimsFile = z.infer<typeof ClaimsFile>;

/** 値が1つの項目（範囲ごとに採用済みが1つ以下） */
export const SINGLE_VALUE_FIELDS: readonly ClaimField[] = [
  'release',
  'japaneseSupport',
  'playerModes',
  'summary',
  'features',
];

/** 範囲のキー（platform、region の順で結合した文字列） */
export function scopeKey(scope: { platform?: string; region?: string }): string {
  return `${scope.platform ?? ''}|${scope.region ?? ''}`;
}

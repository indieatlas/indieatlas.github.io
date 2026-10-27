import { z } from 'zod';
import { Evidence } from './claim.ts';
import { DeveloperId, GameId, HttpUrl, IsoDate, IsoDateTime, Lang, RunId, Store } from './common.ts';

export const GameStatus = z.enum([
  'candidate', // 公開の条件を満たしていない。サイトに出さない
  'published', // 公開中
  'hidden', // 一時的に非公開（誤情報の調査中、権利上の理由など）
  'merged', // 別の作品に統合済み。旧 URL には転送ページを置く
]);
export type GameStatus = z.infer<typeof GameStatus>;

export const Alias = z.object({
  value: z.string().min(1).max(120),
  lang: Lang.optional(),
  kind: z.enum(['localized', 'abbreviation', 'reading', 'romanization', 'former', 'working-title']),
});
export type Alias = z.infer<typeof Alias>;

export const IndieReasonCode = z.enum([
  // インディーと判定する理由
  'self-published', // 開発者とパブリッシャーが同じ
  'independent-publisher', // パブリッシャーが Developer で independence=independent と登録済み
  'solo-developer', // 個人開発と公式に明記されている
  'small-team', // 小規模な体制と公式に明記されている
  'indie-showcase', // インディー向けのイベントやショーケースへの出展
  'indie-fund', // インディー向けの助成やファンドの対象
  // インディーではないと判定する理由
  'major-publisher', // パブリッシャーが Developer で independence=major と登録済み
  'large-studio', // 大規模な開発体制と公式に明記されている
  'subsidiary', // 大手企業の子会社
]);
export type IndieReasonCode = z.infer<typeof IndieReasonCode>;

export const NEGATIVE_INDIE_REASONS: readonly IndieReasonCode[] = ['major-publisher', 'large-studio', 'subsidiary'];

export const IdentityEvidence = z.object({
  field: z.enum(['title', 'aliases', 'externalIds', 'associatedApps', 'officialUrl', 'developers', 'publishers']),
  evidence: Evidence,
});

export const AssociatedApp = z.object({
  store: Store,
  id: z.string().max(200),
  kind: z.enum(['demo', 'playtest', 'prologue', 'dlc', 'soundtrack', 'other']),
  title: z.string().max(120).optional(),
});

export const ExternalIds = z
  .object({
    steamAppId: z.number().int().positive().optional(),
    itchUrl: HttpUrl.optional(),
    igdbId: z.number().int().positive().optional(),
    epicSlug: z.string().max(120).optional(),
    gogId: z.string().max(40).optional(),
    nintendoNsuid: z.string().max(40).optional(),
    psStoreId: z.string().max(80).optional(),
    msStoreId: z.string().max(40).optional(),
    appStoreId: z.string().max(40).optional(),
    googlePlayId: z.string().max(200).optional(),
  })
  .strict();

export const Game = z
  .object({
    schemaVersion: z.literal(1),
    id: GameId,
    status: GameStatus,
    statusReason: z.string().max(200).optional(),
    mergedInto: GameId.optional(),
    title: z.object({
      display: z.string().min(1).max(120), // サイトの表示名。日本語の公式表記があればそれ、なければ原題
      original: z.string().min(1).max(120), // 開発者による正式な表記
      originalLang: Lang,
    }),
    aliases: z.array(Alias).max(30),
    externalIds: ExternalIds,
    associatedApps: z.array(AssociatedApp).max(30),
    officialUrl: HttpUrl.optional(),
    developerIds: z.array(DeveloperId).max(10),
    publisherIds: z.array(DeveloperId).max(10),
    indie: z.object({
      assessment: z.enum(['indie', 'not-indie', 'unknown']), // コードが reasons から計算する（04 §4.4.3）
      reasons: z
        .array(
          z.object({
            code: IndieReasonCode,
            note: z.string().max(200).optional(),
            evidence: z.array(Evidence).min(1).max(5),
          }),
        )
        .max(10),
      assessedAt: IsoDateTime,
    }),
    identityEvidence: z.array(IdentityEvidence).max(50),
    disambiguation: z.string().max(120).optional(), // 同名作品を区別するための内部メモ。サイトには出さない
    createdAt: IsoDateTime,
    addedAt: IsoDate.optional(), // 初めて published になった日（収録日）。published、hidden なら必須
    updatedAt: IsoDateTime,
    createdByRun: RunId,
  })
  .superRefine((g, ctx) => {
    if (g.status === 'merged' && !g.mergedInto) ctx.addIssue({ code: 'custom', message: 'merged requires mergedInto' });
    if (g.status !== 'merged' && g.mergedInto) ctx.addIssue({ code: 'custom', message: 'mergedInto only for merged' });
    if ((g.status === 'published' || g.status === 'hidden') && !g.addedAt) {
      ctx.addIssue({ code: 'custom', message: 'published requires addedAt' });
    }
  });
export type Game = z.infer<typeof Game>;

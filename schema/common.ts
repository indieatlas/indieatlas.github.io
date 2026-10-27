import { z } from 'zod';

export const GameId = z.string().regex(/^g_\d{6}$/);
export const DeveloperId = z.string().regex(/^dev_\d{6}$/);
export const ArticleId = z.string().regex(/^a_[0-9a-f]{16}$/);
export const ClaimId = z.string().regex(/^c_[0-9a-f]{16}$/);
export const CollectionId = z.string().regex(/^col_\d{4}$/);
export const RelationId = z.string().regex(/^r_[0-9a-f]{16}$/);
export const TaskId = z.string().regex(/^t_[0-9a-f]{16}$/);
export const ReviewId = z.string().regex(/^rv_[0-9a-f]{16}$/);
export const SourceId = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(40);
export const TagId = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(40);
export const RunId = z.string().regex(/^(\d+|local-[0-9a-z-]+)$/);

export const IsoDateTime = z.iso.datetime(); // UTC。オフセットは付けない
export const IsoDate = z.iso.date(); // YYYY-MM-DD
export const HttpUrl = z.url({ protocol: /^https?$/ });
export const Lang = z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/); // BCP 47 の簡易形
export const Sha256 = z.string().regex(/^sha256:[0-9a-f]{64}$/);

export const Platform = z.enum([
  'pc', // Windows PC。出典が「PC」とだけ書く場合もこれにする
  'mac',
  'linux',
  'switch',
  'switch2',
  'ps5',
  'ps4',
  'xbox-series',
  'xbox-one',
  'ios',
  'android',
  'browser',
  'meta-quest',
  'other',
]);
export type Platform = z.infer<typeof Platform>;
export const Region = z.enum(['global', 'jp', 'asia', 'na', 'eu', 'other']);
export type Region = z.infer<typeof Region>;
export const Store = z.enum([
  'steam',
  'itch',
  'epic',
  'gog',
  'nintendo-eshop',
  'playstation-store',
  'microsoft-store',
  'app-store',
  'google-play',
  'meta-quest-store',
  'humble',
  'official',
  'other',
]);
export type Store = z.infer<typeof Store>;
export const ReleaseStatus = z.enum(['released', 'early-access', 'upcoming', 'tba', 'cancelled', 'delisted']);
export type ReleaseStatus = z.infer<typeof ReleaseStatus>;
export const Support = z.enum(['yes', 'no', 'planned', 'unknown']);
export type Support = z.infer<typeof Support>;
export const PlayerMode = z.enum(['single', 'local-coop', 'online-coop', 'local-pvp', 'online-pvp', 'async', 'mmo']);
export type PlayerMode = z.infer<typeof PlayerMode>;
export const EvidenceKind = z.enum(['official', 'store', 'media', 'database', 'event']);
export type EvidenceKind = z.infer<typeof EvidenceKind>;
export const ArticleKind = z.enum([
  'announcement',
  'news',
  'preview',
  'review',
  'interview',
  'devlog',
  'feature',
  'roundup',
  'press-release',
  'video',
  'other',
]);
export type ArticleKind = z.infer<typeof ArticleKind>;
export const ArticleRole = z.enum(['primary', 'mention', 'roundup']); // 主題、一部で言及、まとめ記事内の紹介
export type ArticleRole = z.infer<typeof ArticleRole>;
export const TagGroup = z.enum(['genre', 'mechanic', 'play-style', 'theme', 'mood', 'setting', 'art-style']);
export type TagGroup = z.infer<typeof TagGroup>;
export const RelationKind = z.enum([
  'similar-play',
  'same-series',
  'spiritual-successor',
  'shared-theme',
  'often-compared',
]);
export type RelationKind = z.infer<typeof RelationKind>;
export const Actor = z.enum(['human', 'llm', 'agent', 'system']); // agent: 運営者が操作するコーディングエージェント（12）
export type Actor = z.infer<typeof Actor>;

export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

const Year = z.number().int().min(1970).max(2100);
const Month = z.number().int().min(1).max(12);

export const PartialDate = z
  .discriminatedUnion('precision', [
    z.object({ precision: z.literal('day'), year: Year, month: Month, day: z.number().int().min(1).max(31) }),
    z.object({ precision: z.literal('month'), year: Year, month: Month }),
    z.object({ precision: z.literal('quarter'), year: Year, quarter: z.number().int().min(1).max(4) }),
    z.object({ precision: z.literal('half'), year: Year, half: z.union([z.literal(1), z.literal(2)]) }),
    z.object({
      precision: z.literal('season'),
      year: Year,
      season: z.enum(['spring', 'summer', 'autumn', 'winter']),
    }),
    z.object({ precision: z.literal('year'), year: Year }),
  ])
  .superRefine((d, ctx) => {
    if (d.precision === 'day' && !isValidCalendarDate(d.year, d.month, d.day)) {
      ctx.addIssue({ code: 'custom', message: 'invalid calendar date' });
    }
  });
export type PartialDate = z.infer<typeof PartialDate>;

import { z } from 'zod';
import { ArticleImage } from './article.ts';
import { Evidence } from './claim.ts';
import { Actor, GameId, HttpUrl, IsoDate, IsoDateTime, PartialDate, RunId } from './common.ts';

export const EventId = z.string().regex(/^ev_[0-9a-f]{16}$/);

export const EventKind = z.enum([
  'exhibition', // 展示・試遊会、即売会
  'showcase', // 配信の発表会
  'festival', // フェス（Steam Next Fest、A MAZE. など）。会場かオンラインかは format で分ける
  'conference', // 講演が中心の催し
  'awards', // 賞の発表
  'game-jam',
  'sale', // ストアのセール。常に online
  'other',
]);
export type EventKind = z.infer<typeof EventKind>;

/** インディーゲームの催し（data/events/{eventId}.json）。カレンダーに表示する */
export const IndieEvent = z.object({
  schemaVersion: z.literal(1),
  id: EventId,
  status: z.enum(['scheduled', 'tentative', 'cancelled', 'hidden']),
  name: z.string().min(1).max(120),
  nameEn: z.string().max(120).optional(),
  // この回を指すほかの呼び名（略称など。例: ゲムダン14）。感想の記事を探す語と、記事との照合に使う
  aliases: z.array(z.string().min(2).max(60)).max(8).optional(),
  kind: EventKind,
  // 会場で開く催し（in-person、配信もあるものは hybrid）とオンラインの催しを分ける。
  // オンラインの催しは location を持たない。会場の催しで location がなければ会場未定（check:data の D-15）
  format: z.enum(['in-person', 'online', 'hybrid']),
  start: PartialDate, // 日本時間の暦日
  end: PartialDate.optional(),
  time: z.string().max(40).optional(), // 例: 12:00〜18:00（日本時間）
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
  url: HttpUrl, // 催しの案内のページ（公式のページ。なければ告知を伝える記事）
  summary: z.string().min(20).max(160), // 当サイトが書く短い説明
  image: ArticleImage.optional(), // 案内のページの OGP 画像（public/media/events/）
  games: z.array(GameId).max(60), // 出展、発表される収録作品
  evidence: z.array(Evidence).min(1).max(10),
  recheckAfter: IsoDate.optional(), // 日程が変わっていないかを確かめ直す日
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  createdBy: Actor,
  createdByRun: RunId,
});
export type IndieEvent = z.infer<typeof IndieEvent>;

export const EventReportPlatform = z.enum(['note', 'hatena-blog', 'blog']);
export type EventReportPlatform = z.infer<typeof EventReportPlatform>;

/** 会場の催しに行った人、出展した人が書いた感想や記録（個人のブログ、note など）。見出し、共有用の画像、リンクを載せる */
export const EventReport = z.object({
  url: HttpUrl,
  title: z.string().min(1).max(300),
  author: z.string().min(1).max(80).optional(), // 書き手の表示名
  image: HttpUrl.optional(), // 記事の共有用の画像（OGP）。保存せず配信元を参照する
  platform: EventReportPlatform,
  publishedAt: IsoDateTime.optional(), // 分からなければ省く
  foundVia: z.enum(['note-hashtag', 'hatena-bookmark']),
  foundAt: IsoDateTime,
  status: z.enum(['shown', 'hidden']), // hidden: 催しと関係がないなどで出さない（集め直しても戻さない）
});
export type EventReport = z.infer<typeof EventReport>;

/** 催しごとの感想の一覧（data/event-reports/{eventId}.json） */
export const EventReportsFile = z.object({
  schemaVersion: z.literal(1),
  eventId: EventId,
  reports: z.array(EventReport).max(80),
});
export type EventReportsFile = z.infer<typeof EventReportsFile>;

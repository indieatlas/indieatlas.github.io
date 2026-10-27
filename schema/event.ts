import { z } from 'zod';
import { Evidence } from './claim.ts';
import { Actor, GameId, HttpUrl, IsoDate, IsoDateTime, PartialDate, RunId } from './common.ts';

export const EventId = z.string().regex(/^ev_[0-9a-f]{16}$/);

export const EventKind = z.enum([
  'exhibition', // 展示・試遊会、即売会
  'showcase', // 配信の発表会
  'festival', // オンラインのフェス（Steam Next Fest など）
  'conference', // 講演が中心の催し
  'awards', // 賞の発表
  'game-jam',
  'sale',
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
  kind: EventKind,
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
  games: z.array(GameId).max(60), // 出展、発表される収録作品
  evidence: z.array(Evidence).min(1).max(10),
  recheckAfter: IsoDate.optional(), // 日程が変わっていないかを確かめ直す日
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  createdBy: Actor,
  createdByRun: RunId,
});
export type IndieEvent = z.infer<typeof IndieEvent>;

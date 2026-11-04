import { z } from 'zod';
import { HttpUrl, IsoDateTime } from './common.ts';

/**
 * Amazon のゲームの売れ筋（Creators API から取得）。.generated/amazon/ranking.json に置き、リポジトリには入れない。
 * 商品の情報は取得から24時間を過ぎたら使わない（Amazon の利用条件）
 */
export const AmazonRanking = z.object({
  schemaVersion: z.literal(1),
  fetchedAt: IsoDateTime,
  items: z
    .array(
      z.object({
        asin: z.string().regex(/^[A-Z0-9]{10}$/),
        title: z.string().min(1).max(300),
        url: HttpUrl, // アソシエイトのタグ付きの商品ページ
        image: z
          .object({ url: HttpUrl, width: z.number().int().positive(), height: z.number().int().positive() })
          .optional(),
        salesRank: z.number().int().positive(),
        platform: z.string().max(40).optional(), // 例: Nintendo Switch 2
      }),
    )
    .max(50),
});
export type AmazonRanking = z.infer<typeof AmazonRanking>;

/**
 * Steam のインディーの売上上位（store.steampowered.com の検索結果、`filter=topsellers&tags=492`）。
 * .generated/ranking/steam.json に置く。API キーを使わずに取れる売れ筋として、Amazon の売れ筋がないときに出す
 */
export const SteamRanking = z.object({
  schemaVersion: z.literal(1),
  fetchedAt: IsoDateTime,
  items: z
    .array(
      z.object({
        appId: z.number().int().positive(),
        title: z.string().min(1).max(300),
        image: HttpUrl.optional(), // 231x87 のカプセル画像
        consoles: z.array(z.string().max(20)).max(10).optional(), // IGDB で分かった家庭用ゲーム機。調べられなければ省く
      }),
    )
    .max(50),
});
export type SteamRanking = z.infer<typeof SteamRanking>;

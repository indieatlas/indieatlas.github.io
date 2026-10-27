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
        image: z.object({ url: HttpUrl, width: z.number().int().positive(), height: z.number().int().positive() }).optional(),
        salesRank: z.number().int().positive(),
        platform: z.string().max(40).optional(), // 例: Nintendo Switch 2
      }),
    )
    .max(50),
});
export type AmazonRanking = z.infer<typeof AmazonRanking>;

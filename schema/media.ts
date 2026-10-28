import { z } from 'zod';
import { GameId, HttpUrl, IsoDateTime } from './common.ts';

const Hex = z.string().regex(/^#[0-9a-f]{6}$/);

/** 作品の画像から抽出した色（作品詳細のページの色に使う）。data/media/palettes.json */
export const ImagePalettes = z.object({
  schemaVersion: z.literal(1),
  entries: z.record(
    GameId,
    z.object({
      imageUrl: HttpUrl, // 色を抽出した画像
      colors: z.array(Hex).min(1).max(3), // 主な色から順に
      computedAt: IsoDateTime,
    }),
  ),
});
export type ImagePalettes = z.infer<typeof ImagePalettes>;

/**
 * 作品の知名度の目安（data/metrics/popularity.json）。Steam のレビュー数（appdetails の recommendations.total）。
 * サイトでの見せ方の強弱（定番、人気）を決めるのに使い、数そのものは丸めて表示する
 */
export const PopularityMetrics = z.object({
  schemaVersion: z.literal(1),
  entries: z.record(
    GameId,
    z.object({
      steamReviews: z.number().int().min(0),
      // Steam のレビューの好評の割合（appreviews の query_summary）。取得できた環境でだけ入る
      steamScore: z
        .object({
          positive: z.number().int().min(0),
          total: z.number().int().min(1),
          desc: z.string().max(40),
          language: z.literal('japanese').optional(), // 日本語のレビューだけの集計
        })
        .optional(),
      // IGDB の評価（0〜100）。total は利用者と批評の総合、critic は批評サイトの平均
      igdb: z
        .object({
          total: z.number().min(0).max(100).optional(),
          totalCount: z.number().int().min(0).optional(),
          critic: z.number().min(0).max(100).optional(),
          criticCount: z.number().int().min(0).optional(),
        })
        .optional(),
      retrievedAt: IsoDateTime,
    }),
  ),
});
export type PopularityMetrics = z.infer<typeof PopularityMetrics>;

/**
 * Steam のレビューの要約（data/metrics/review-summaries.json、06 §6.13.6）。
 * 利用者のレビューでよく挙がる点を当サイトの言葉でまとめたもの。各行は2件以上のレビューに支えられている
 */
const SummaryPoint = z.object({
  text: z.string().min(8).max(60),
  reviewIds: z.array(z.string().regex(/^[\w-]{1,64}$/)).min(2).max(10), // 根拠のレビュー（レビューの ID か投稿者の ID）。サイトには出さない
});
export const ReviewSummaries = z.object({
  schemaVersion: z.literal(1),
  entries: z.record(
    GameId,
    z.object({
      pros: z.array(SummaryPoint).min(1).max(4),
      cons: z.array(SummaryPoint).max(3),
      reviewCount: z.number().int().min(1), // 要約に使ったレビューの数
      model: z.string().min(1).max(80),
      generatedAt: IsoDateTime,
    }),
  ),
});
export type ReviewSummaries = z.infer<typeof ReviewSummaries>;

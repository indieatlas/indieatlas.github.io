import { z } from 'zod';
import {
  ArticleId,
  ArticleKind,
  ArticleRole,
  GameId,
  HttpUrl,
  IsoDateTime,
  Lang,
  RunId,
  Sha256,
  SourceId,
} from './common.ts';

/** 記事の OGP 画像。WebP に変換して public/media/articles/ に保存する（11 の決定ログ 2026-10-28） */
export const ArticleImage = z.object({
  path: z.string().regex(/^media\/articles\/a_[0-9a-f]{16}\.webp$/), // public/ からの相対パス
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sourceUrl: HttpUrl, // og:image の元の URL
  retrievedAt: IsoDateTime,
  hash: Sha256, // 保存したファイルのハッシュ
});
export type ArticleImage = z.infer<typeof ArticleImage>;

export const Article = z.object({
  schemaVersion: z.literal(1),
  id: ArticleId,
  url: HttpUrl, // 最初に見つけた URL
  canonicalUrl: HttpUrl, // ID を計算する元の URL（04 §4.2.2）
  urlAliases: z.array(HttpUrl).max(10),
  sourceId: SourceId.optional(), // 情報源として登録していない媒体の記事では省略する
  outlet: z.object({ name: z.string().min(1).max(80), domain: z.string().min(3).max(120) }),
  title: z.string().min(1).max(300), // 原文のタイトル
  lang: Lang,
  kind: ArticleKind,
  publishedAt: IsoDateTime.optional(),
  retrievedAt: IsoDateTime,
  summaryJa: z.string().max(120).optional(), // 当サイトが書く短い説明。情報源の権利条件が許す場合だけ
  image: ArticleImage.optional(), // 記事の OGP 画像を縮小して保存したもの（public/ の下）
  derivedFrom: z
    .object({
      kind: z.literal('press-release'),
      key: z.string().min(3).max(200), // 同じプレスリリースを識別するキー。元の URL があれば正規化した URL
      url: HttpUrl.optional(),
    })
    .optional(),
  games: z
    .array(
      z.object({
        gameId: GameId,
        role: ArticleRole,
        note: z.string().max(80).optional(), // 関連づけた理由（内部用）
      }),
    )
    .max(30),
  status: z.enum(['active', 'unavailable']), // unavailable: リンク切れなど
  contentHash: Sha256.optional(), // 本文のハッシュ。本文そのものは保存しない
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  createdByRun: RunId,
});
export type Article = z.infer<typeof Article>;

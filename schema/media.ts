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

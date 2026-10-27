import sharp from 'sharp';

export const ARTICLE_IMAGE_WIDTH = 720;

/** 画像を最大幅で縮小し、WebP に圧縮する */
export async function toWebp(
  input: Uint8Array,
  maxWidth = ARTICLE_IMAGE_WIDTH,
): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(input, { failOn: 'error' })
    .rotate()
    .resize({ width: maxWidth, withoutEnlargement: true })
    .webp({ quality: 70, effort: 5 })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

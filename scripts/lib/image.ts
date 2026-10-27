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

/** 画像の主な色を最大3つ返す。彩度のある画素を色相ごとに集め、多い順に平均の色を出す */
export async function dominantColors(input: Uint8Array): Promise<string[]> {
  const { data } = await sharp(input)
    .resize(48, 48, { fit: 'cover' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const buckets = new Map<number, { w: number; r: number; g: number; b: number }>();
  let fallback = { w: 0, r: 0, g: 0, b: 0 };
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i]!,
      g = data[i + 1]!,
      b = data[i + 2]!;
    const max = Math.max(r, g, b) / 255;
    const min = Math.min(r, g, b) / 255;
    const l = (max + min) / 2;
    const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
    fallback = { w: fallback.w + 1, r: fallback.r + r, g: fallback.g + g, b: fallback.b + b };
    if (s < 0.25 || l < 0.12 || l > 0.88) continue;
    let h = 0;
    const d = max - min;
    if (max === r / 255) h = ((g - b) / 255 / d + 6) % 6;
    else if (max === g / 255) h = (b - r) / 255 / d + 2;
    else h = (r - g) / 255 / d + 4;
    const key = Math.floor(h * 4); // 24 区分
    const w = s * (1 - Math.abs(l - 0.5));
    const cur = buckets.get(key) ?? { w: 0, r: 0, g: 0, b: 0 };
    buckets.set(key, { w: cur.w + w, r: cur.r + r * w, g: cur.g + g * w, b: cur.b + b * w });
  }
  const hex = (v: { w: number; r: number; g: number; b: number }) =>
    '#' +
    [v.r, v.g, v.b]
      .map((c) =>
        Math.round(c / v.w)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('');
  const top = [...buckets.values()].sort((a, b) => b.w - a.w).slice(0, 3);
  return top.length > 0 ? top.map(hex) : [hex(fallback)];
}

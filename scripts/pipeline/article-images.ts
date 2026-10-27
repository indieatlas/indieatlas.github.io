import fs from 'node:fs';
import path from 'node:path';
import type { Article, ArticleImage } from '../../schema/article.ts';
import type { HttpClient } from '../fetch/http.ts';
import { toIsoDateTime } from '../lib/clock.ts';
import { sha256Tagged } from '../lib/hash.ts';
import { toWebp } from '../lib/image.ts';

/** HTML から og:image（なければ twitter:image）の URL を読む */
export function findOgImage(html: string, pageUrl: string): string | undefined {
  const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const key of ['og:image:secure_url', 'og:image', 'twitter:image']) {
    for (const m of metas) {
      const prop = m.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1];
      if (prop?.toLowerCase() !== key) continue;
      const content = m.match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1];
      if (!content) continue;
      try {
        const u = new URL(content.replace(/&amp;/g, '&'), pageUrl);
        if (u.protocol === 'https:' || u.protocol === 'http:') return u.href;
      } catch {
        // 不正な URL は読み飛ばす
      }
    }
  }
  return undefined;
}

export function articleImagePath(articleId: string): string {
  return `media/articles/${articleId}.webp`;
}

/**
 * ページから OGP 画像を取得し、WebP に変換して publicDir/{rel} に保存する。
 * 画像の情報を返す。画像がなければ undefined。
 */
export async function fetchOgImageTo(
  http: HttpClient,
  pageUrl: string,
  rel: string,
  publicDir: string,
): Promise<ArticleImage | undefined> {
  const page = await http.get(pageUrl);
  if (page.status !== 200) throw new Error(`HTTP ${page.status}: ${pageUrl}`);
  if (/\bnoai\b|\bnoimageai\b/i.test(page.text.match(/<meta[^>]+name=["']robots["'][^>]*>/i)?.[0] ?? ''))
    return undefined;
  const src = findOgImage(page.text, page.url);
  if (!src) return undefined;
  const img = await http.get(src);
  if (img.status !== 200) throw new Error(`HTTP ${img.status}: ${src}`);
  const webp = await toWebp(img.bytes);
  const file = path.join(publicDir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, webp.data);
  return {
    path: rel,
    width: webp.width,
    height: webp.height,
    sourceUrl: src,
    retrievedAt: toIsoDateTime(img.retrievedAt),
    hash: sha256Tagged(webp.data),
  };
}

/** 記事の OGP 画像を public/media/articles/ に保存する */
export function fetchArticleImage(
  http: HttpClient,
  article: Article,
  publicDir: string,
): Promise<ArticleImage | undefined> {
  return fetchOgImageTo(http, article.canonicalUrl, articleImagePath(article.id), publicDir);
}

export function eventImagePath(eventId: string): string {
  return `media/events/${eventId}.webp`;
}

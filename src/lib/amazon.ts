import type { Platform } from '../../schema/common.ts';
import { site } from '../config/site.ts';

// Amazon.co.jp へのリンク。アソシエイトのトラッキング ID を付ける（商品の情報は取得しない）
const CONSOLES: Platform[] = ['switch', 'switch2', 'ps5', 'ps4', 'xbox-series', 'xbox-one'];

/** 家庭用ゲーム機で出ている作品なら、Amazon でのパッケージ版などの検索結果への URL */
export function amazonSearchUrl(title: string, platforms: Platform[]): string | undefined {
  if (!site.amazonTag || !platforms.some((p) => CONSOLES.includes(p))) return undefined;
  const q = new URLSearchParams({ k: title, i: 'videogames', tag: site.amazonTag });
  return `https://www.amazon.co.jp/s?${q}`;
}

/** Amazon のゲームの売れ筋ランキング */
export function amazonBestsellersUrl(): string | undefined {
  if (!site.amazonTag) return undefined;
  return `https://www.amazon.co.jp/gp/bestsellers/videogames/?tag=${encodeURIComponent(site.amazonTag)}`;
}

export const AMAZON_DISCLOSURE = `Amazonのアソシエイトとして、${site.name}は適格販売により収入を得ています。`;

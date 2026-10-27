import fs from 'node:fs';
import path from 'node:path';
import type {
  SiteArticle,
  SiteCollection,
  SiteEvent,
  SiteGame,
  SiteGenre,
  SiteMeta,
  SiteStats,
  SiteTag,
} from '../../schema/site-data.ts';

/**
 * サイト用データの読み出し。.generated/site-data/ だけを読む（03 §3.3）。
 * npm run prepare-site が作る。
 */
const DIR = path.resolve(process.cwd(), '.generated/site-data');
const cache = new Map<string, unknown>();

function load<T>(name: string): T {
  if (!cache.has(name)) {
    const file = path.join(DIR, `${name}.json`);
    if (!fs.existsSync(file)) throw new Error(`${file} がない。先に npm run prepare-site を実行する`);
    cache.set(name, JSON.parse(fs.readFileSync(file, 'utf8')));
  }
  return cache.get(name) as T;
}

export const getGames = () => load<SiteGame[]>('games');
export const getArticles = () => load<SiteArticle[]>('articles');
export const getCollections = () => load<SiteCollection[]>('collections');
export const getTags = () => load<SiteTag[]>('tags');
export const getGenres = () => load<SiteGenre[]>('genres');
export const getEvents = () => load<SiteEvent[]>('events');
export const getStats = () => load<SiteStats>('stats');
export const getMeta = () => load<SiteMeta & { hashInputs: unknown }>('meta');
export const getRedirects = () => load<{ from: string; to: string }[]>('redirects');

let gameIndex: Map<string, SiteGame> | undefined;
export function getGame(id: string): SiteGame | undefined {
  gameIndex ??= new Map(getGames().map((g) => [g.id, g]));
  return gameIndex.get(id);
}

let articleIndex: Map<string, SiteArticle> | undefined;
export function getArticle(id: string): SiteArticle | undefined {
  articleIndex ??= new Map(getArticles().map((a) => [a.id, a]));
  return articleIndex.get(id);
}

export function getCollection(id: string): SiteCollection | undefined {
  return getCollections().find((c) => c.id === id);
}

/** 更新の新しい順（情報か関連記事が最後に増えた日時。同じなら ID の新しい順） */
export function gamesByActivity(): SiteGame[] {
  return [...getGames()].sort((a, b) =>
    a.activityAt === b.activityAt ? (a.id < b.id ? 1 : -1) : a.activityAt < b.activityAt ? 1 : -1,
  );
}

/** 収録日の新しい順（同じ日は ID の新しい順） */
export function gamesByAdded(): SiteGame[] {
  return [...getGames()].sort((a, b) =>
    a.addedAt === b.addedAt ? (a.id < b.id ? 1 : -1) : a.addedAt < b.addedAt ? 1 : -1,
  );
}

/** ジャンルのカテゴリ色の番号（範囲外は -1） */
export function genreColorIndex(genreId: string | undefined): number {
  if (!genreId) return -1;
  return getGenres().findIndex((l) => l.id === genreId);
}

export function genreColorVar(genreId: string | undefined): string {
  const i = genreColorIndex(genreId);
  return i < 0 ? 'var(--genre-neutral)' : `var(--genre-c${i})`;
}

/** 背景の WebGL に混ぜる色の CSS 変数名 */
export function genreColorName(genreId: string | undefined): string {
  const i = genreColorIndex(genreId);
  return i < 0 ? '--genre-neutral' : `--genre-c${i}`;
}

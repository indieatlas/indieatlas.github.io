import fs from 'node:fs';
import path from 'node:path';
import type {
  SiteArticle,
  SiteCollection,
  SiteDeveloper,
  SiteEvent,
  SiteGame,
  SiteGenre,
  SiteMeta,
  SiteStats,
  SiteTag,
} from '../../schema/site-data.ts';
import type { SiteRanking } from '../../scripts/build/prepare-site.ts';

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
export const getDevelopers = () => load<SiteDeveloper[]>('developers');
export const getRanking = () => load<SiteRanking>('ranking');
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
/**
 * 一覧に出す記事。同じ話題の記事（topicOf がある記事）は、まとまりの先頭の記事に添えるので除く。
 * 種別で絞るときは、先頭の記事が別の種別なら残す
 */
export function listedArticles(kind?: SiteArticle['kind']): SiteArticle[] {
  const byId = new Map(getArticles().map((a) => [a.id, a]));
  return getArticles().filter(
    (a) => (!kind || a.kind === kind) && (!a.topicOf || (kind !== undefined && byId.get(a.topicOf)?.kind !== kind)),
  );
}

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

const KIND_WEIGHT: Partial<Record<SiteArticle['kind'], number>> = {
  review: 2,
  interview: 2,
  feature: 2,
  announcement: 1,
  preview: 1,
};
const PROMINENCE_WEIGHT = { landmark: 3, notable: 1.5, standard: 0 } as const;

/**
 * ホームで大きく見せる記事を選ぶ。画像のある新しい記事のうち、記事の種類（レビューや特集）と
 * 主な作品の知名度で点を付ける。日付は最も新しい記事からの経過日数で数え、ビルドの日に左右されない
 */
export function homeNews(featuredCount = 3, restCount = 8): { featured: SiteArticle[]; rest: SiteArticle[] } {
  const articles = listedArticles().filter((a) => a.publishedAt);
  const newest = Date.parse(articles[0]?.publishedAt ?? '1970-01-01');
  const score = (a: SiteArticle) => {
    const days = (newest - Date.parse(a.publishedAt!)) / 86_400_000;
    const primary = a.games.find((g) => g.role === 'primary') ?? a.games[0];
    const game = primary ? getGame(primary.gameId) : undefined;
    // はてなブックマークで反応の多い記事は、話題になっているので少し前に出す
    const buzz = a.reactions ? Math.min(2, a.reactions.bookmarkCount / 30) : 0;
    return (
      Math.max(0, 6 - days / 15) +
      (KIND_WEIGHT[a.kind] ?? 0) +
      (game ? PROMINENCE_WEIGHT[game.prominence] : 0) +
      buzz
    );
  };
  // 記事の画像か、主な作品の画像のある記事だけを大きく見せる
  const hasVisual = (a: SiteArticle) =>
    !!a.image || a.games.some((g) => g.role === 'primary' && getGame(g.gameId)?.image);
  const pool = articles.slice(0, 24).filter(hasVisual);
  // 点の高い順。先頭を一番大きい枠に置く
  // 同じ作品の記事は大きな枠に1件だけ
  const featured: SiteArticle[] = [];
  const usedGames = new Set<string>();
  for (const a of [...pool].sort((a, b) => score(b) - score(a) || (a.publishedAt! < b.publishedAt! ? 1 : -1))) {
    if (featured.length >= featuredCount) break;
    const gid = (a.games.find((g) => g.role === 'primary') ?? a.games[0])?.gameId;
    if (gid && usedGames.has(gid)) continue;
    if (gid) usedGames.add(gid);
    featured.push(a);
  }
  const ids = new Set(featured.map((a) => a.id));
  return { featured, rest: articles.filter((a) => !ids.has(a.id)).slice(0, restCount) };
}

export function getDeveloper(id: string): SiteDeveloper | undefined {
  return getDevelopers().find((d) => d.id === id);
}

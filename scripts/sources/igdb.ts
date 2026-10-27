import type { PartialDate, Platform, Region, ReleaseStatus, Store } from '../../schema/common.ts';
import type { HttpClient } from '../fetch/http.ts';
import { storeOf } from '../lib/domains.ts';
import { hasPassed, startOf } from '../lib/partial-date.ts';

/**
 * IGDB（https://api-docs.igdb.com/）のアダプタ。Twitch の Client Credentials でトークンを得て、
 * Apicalypse の問い合わせを POST する。キーは環境変数（ローカルでは .env）からだけ読む。
 */
export const IGDB_API = 'https://api.igdb.com/v4/';
export const IGDB_STEAM_SOURCE = 1; // external_game_sources の Steam

export interface IgdbCredentials {
  clientId: string;
  clientSecret: string;
}

export interface IgdbReleaseDate {
  date?: number; // UNIX 秒
  human?: string;
  date_format?: number; // 0 YYYYMMDD, 1 YYYYMM, 2 YYYY, 3〜6 YYYYQ1〜Q4, 7 TBD
  release_region?: number; // 1 europe, 2 north_america, 5 japan, 7 asia, 8 worldwide など
  platform?: { id: number; slug: string };
}

export interface IgdbGame {
  id: number;
  name: string;
  slug: string;
  url?: string;
  platforms?: { id: number; name: string; slug: string }[];
  release_dates?: IgdbReleaseDate[];
  screenshots?: { image_id: string; width?: number; height?: number }[];
  websites?: { url: string }[];
  external_games?: { url?: string }[];
}

export const IGDB_GAME_FIELDS = [
  'name',
  'slug',
  'url',
  'platforms.name',
  'platforms.slug',
  'release_dates.date',
  'release_dates.human',
  'release_dates.date_format',
  'release_dates.release_region',
  'release_dates.platform.slug',
  'screenshots.image_id',
  'screenshots.width',
  'screenshots.height',
  'websites.url',
  'external_games.url',
].join(',');

export interface IgdbClient {
  query<T>(endpoint: string, body: string): Promise<T>;
}

export async function createIgdbClient(http: HttpClient, cred: IgdbCredentials): Promise<IgdbClient> {
  if (!http.post) throw new Error('http client does not support POST');
  const post = http.post.bind(http);
  const tokenUrl =
    `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(cred.clientId)}` +
    `&client_secret=${encodeURIComponent(cred.clientSecret)}&grant_type=client_credentials`;
  const res = await post(tokenUrl, '');
  if (res.status !== 200) throw new Error(`IGDB token: HTTP ${res.status}`);
  const token = (JSON.parse(res.text) as { access_token?: string }).access_token;
  if (!token) throw new Error('IGDB token: no access_token');
  return {
    async query<T>(endpoint: string, body: string): Promise<T> {
      const r = await post(IGDB_API + endpoint, body, {
        headers: { 'Client-ID': cred.clientId, Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
      });
      if (r.status !== 200) throw new Error(`IGDB ${endpoint}: HTTP ${r.status} ${r.text.slice(0, 200)}`);
      return JSON.parse(r.text) as T;
    },
  };
}

/** Steam の ID から IGDB の作品 ID を引く */
export async function igdbIdsForSteam(client: IgdbClient, steamAppIds: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  for (let i = 0; i < steamAppIds.length; i += 100) {
    const chunk = steamAppIds.slice(i, i + 100);
    const rows = await client.query<{ game?: number; uid: string }[]>(
      'external_games',
      `fields game,uid; where external_game_source = ${IGDB_STEAM_SOURCE} & uid = (${chunk.map((id) => `"${id}"`).join(',')}); limit 500;`,
    );
    for (const r of rows) if (r.game) out.set(Number(r.uid), r.game);
  }
  return out;
}

export async function igdbGames(client: IgdbClient, ids: number[]): Promise<IgdbGame[]> {
  const out: IgdbGame[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    out.push(
      ...(await client.query<IgdbGame[]>(
        'games',
        `fields ${IGDB_GAME_FIELDS}; where id = (${chunk.join(',')}); limit 500;`,
      )),
    );
  }
  return out;
}

/** IGDB の機種の slug を、Indie Atlas の機種にする。扱わない機種は undefined */
const PLATFORMS: Record<string, Platform> = {
  win: 'pc',
  mac: 'mac',
  linux: 'linux',
  switch: 'switch',
  'switch-2': 'switch2',
  ps5: 'ps5',
  'ps4--1': 'ps4',
  'series-x-s': 'xbox-series',
  xboxone: 'xbox-one',
  ios: 'ios',
  android: 'android',
  browser: 'browser',
  'meta-quest-2': 'meta-quest',
  'meta-quest-3': 'meta-quest',
  'oculus-quest': 'meta-quest',
};

export function mapPlatform(slug: string | undefined): Platform | undefined {
  return slug ? PLATFORMS[slug] : undefined;
}

const REGIONS: Record<number, Region> = { 8: 'global', 5: 'jp', 1: 'eu', 2: 'na', 7: 'asia' };

export function mapRegion(id: number | undefined): Region {
  return id !== undefined ? (REGIONS[id] ?? 'other') : 'global';
}

/** IGDB の発売日を PartialDate にする（日付は UTC の暦日として読む） */
export function igdbDate(r: IgdbReleaseDate): PartialDate | undefined {
  if (r.date === undefined || r.date_format === 7) return undefined;
  const d = new Date(r.date * 1000);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  switch (r.date_format ?? 0) {
    case 0:
      return { precision: 'day', year, month, day: d.getUTCDate() };
    case 1:
      return { precision: 'month', year, month };
    case 2:
      return { precision: 'year', year };
    case 3:
    case 4:
    case 5:
    case 6:
      return { precision: 'quarter', year, quarter: (r.date_format! - 2) as 1 | 2 | 3 | 4 };
    default:
      return undefined;
  }
}

/** 地域の優先順: 全世界、日本、北米、欧州、アジア、その他 */
const REGION_ORDER: Region[] = ['global', 'jp', 'na', 'eu', 'asia', 'other'];

export interface IgdbRelease {
  platform: Platform;
  region: Region;
  status: ReleaseStatus;
  date?: PartialDate;
  rawText?: string;
}

/** 機種ごとに1つの発売情報を選ぶ。発売日が過ぎていれば発売中、先なら発売予定、未定なら tba */
export function igdbReleases(g: IgdbGame, today: string): IgdbRelease[] {
  const byPlatform = new Map<Platform, IgdbReleaseDate[]>();
  for (const r of g.release_dates ?? []) {
    const p = mapPlatform(r.platform?.slug);
    if (!p) continue;
    byPlatform.set(p, [...(byPlatform.get(p) ?? []), r]);
  }
  const out: IgdbRelease[] = [];
  for (const [platform, list] of byPlatform) {
    const sorted = [...list].sort(
      (a, b) =>
        REGION_ORDER.indexOf(mapRegion(a.release_region)) - REGION_ORDER.indexOf(mapRegion(b.release_region)) ||
        (a.date ?? Infinity) - (b.date ?? Infinity),
    );
    const r = sorted[0]!;
    const date = igdbDate(r);
    // 日まで分かれば当日以前を発売中、粗い時期ならその期間が終わっていれば発売中とする
    const status: ReleaseStatus = !date
      ? 'tba'
      : date.precision === 'day'
        ? startOf(date) <= today
          ? 'released'
          : 'upcoming'
        : hasPassed(date, today)
          ? 'released'
          : 'upcoming';
    out.push({
      platform,
      region: mapRegion(r.release_region),
      status,
      ...(date ? { date } : {}),
      ...(r.human ? { rawText: r.human.slice(0, 60) } : {}),
    });
  }
  return out;
}

export function igdbScreenshotUrl(imageId: string, size: 't_screenshot_big' | 't_1080p' = 't_screenshot_big'): string {
  return `https://images.igdb.com/igdb/image/upload/${size}/${imageId}.jpg`;
}

export function igdbPageUrl(g: IgdbGame): string {
  return g.url ?? `https://www.igdb.com/games/${g.slug}`;
}

/** ストアの URL を日本向けの表示にそろえる。扱わない形なら undefined */
function normalizeStoreUrl(raw: string): { store: Store; url: string } | undefined {
  let u: URL;
  try {
    u = new URL(raw.replace(/^http:/, 'https:'));
  } catch {
    return undefined;
  }
  if (u.hostname === 'itunes.apple.com') u.hostname = 'apps.apple.com';
  if (u.hostname === 'www.epicgames.com' && u.pathname.startsWith('/store/')) {
    u.hostname = 'store.epicgames.com';
    u.pathname = u.pathname.slice('/store'.length);
  }
  const store = storeOf(u.toString()) as Store | undefined;
  if (!store || store === 'steam') return undefined; // Steam はストアの情報から別に作る
  switch (store) {
    case 'playstation-store':
      u.pathname = u.pathname.replace(/^\/[a-z]{2}-[a-z]{2}\//i, '/ja-jp/');
      break;
    case 'microsoft-store':
      if (!/\/games\/store\//.test(u.pathname)) return undefined;
      u.pathname = u.pathname.replace(/^\/[a-z]{2}-[a-z]{2}\//i, '/ja-JP/');
      break;
    case 'epic':
      u.pathname = u.pathname.replace(/^\/[a-z]{2}(-[a-z]{2})?\//i, '/ja/');
      break;
    case 'gog':
      u.pathname = u.pathname.replace(/^\/[a-z]{2}\/game\//, '/game/');
      break;
    case 'app-store':
      u.pathname = u.pathname.replace(/^\/[a-z]{2}\/app\//, '/jp/app/');
      break;
  }
  u.search = store === 'google-play' ? u.search : '';
  u.hash = '';
  return { store, url: u.toString() };
}

/** IGDB の Web サイトと外部 ID から、Steam 以外のストアへのリンクを1ストア1件ずつ選ぶ */
export function igdbStoreLinks(g: IgdbGame): { store: Store; url: string }[] {
  const out = new Map<Store, string>();
  const urls = [...(g.websites ?? []).map((w) => w.url), ...(g.external_games ?? []).flatMap((e) => (e.url ? [e.url] : []))];
  for (const raw of urls) {
    const link = normalizeStoreUrl(raw);
    if (link && !out.has(link.store)) out.set(link.store, link.url);
  }
  return [...out].map(([store, url]) => ({ store, url }));
}

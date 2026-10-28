import fs from 'node:fs';
import path from 'node:path';
import { toIsoDateTime, now } from '../lib/clock.ts';
import { PROJECT_ROOT, type RepoData } from '../lib/repo-io.ts';
import { codeHashes, contentHash, siteDataHash, type HashInputs } from './content-hash.ts';
import { buildSiteData } from './site-data.ts';
import { AmazonRanking, SteamRanking } from '../../schema/amazon.ts';
import { site as siteConfig } from '../../src/config/site.ts';
import { amazonSearchUrl, isFresh } from '../sources/amazon.ts';

export const SITE_DATA_DIR = path.join(PROJECT_ROOT, '.generated/site-data');
export const HOSTING_DIR = path.join(PROJECT_ROOT, '.generated/hosting');
export const AMAZON_RANKING_FILE = path.join(PROJECT_ROOT, '.generated/amazon/ranking.json');
export const STEAM_RANKING_FILE = path.join(PROJECT_ROOT, '.generated/ranking/steam.json');

/** 取得から3日以内の Steam の売上上位を読む。なければ undefined */
export function readFreshSteamRanking(file = STEAM_RANKING_FILE, at = now()): SteamRanking | undefined {
  if (!fs.existsSync(file)) return undefined;
  const r = SteamRanking.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')));
  return r.success && at.getTime() - Date.parse(r.data.fetchedAt) < 3 * 86_400_000 ? r.data : undefined;
}

const CONSOLE_LABELS: Record<string, string> = {
  switch: 'Switch',
  switch2: 'Switch 2',
  ps5: 'PS5',
  ps4: 'PS4',
  'xbox-series': 'Xbox',
  'xbox-one': 'Xbox',
};
const CONSOLE_ORDER = ['switch2', 'switch', 'ps5', 'ps4', 'xbox-series', 'xbox-one'];
const consoleLabel = (consoles: string[]) =>
  [
    ...new Set(
      [...consoles]
        .sort((a, b) => CONSOLE_ORDER.indexOf(a) - CONSOLE_ORDER.indexOf(b))
        .map((c) => CONSOLE_LABELS[c] ?? c),
    ),
  ].join(' / ');

/** サイトに出す売れ筋の1件。リンクは Amazon（アソシエイト）。PC だけの作品は Steam のストア */
export interface SiteRankingItem {
  title: string;
  image?: { url: string; width: number; height: number };
  url: string;
  store?: 'amazon' | 'steam';
  platform?: string;
  gameId?: string; // 収録作品なら、その ID
}
export interface SiteRanking {
  source?: 'amazon' | 'steam';
  fetchedAt?: string;
  items: SiteRankingItem[];
}

/** Amazon の売れ筋があればそれを、なければ Steam のインディーの売上上位を、Amazon へのリンクで出す */
export function siteRanking(repo: RepoData, amazon?: AmazonRanking, steam?: SteamRanking): SiteRanking {
  if (amazon && amazon.items.length) {
    return {
      source: 'amazon',
      fetchedAt: amazon.fetchedAt,
      items: amazon.items.map((i) => ({
        title: i.title,
        url: i.url,
        ...(i.image ? { image: i.image } : {}),
        ...(i.platform ? { platform: i.platform } : {}),
      })),
    };
  }
  if (steam && steam.items.length && siteConfig.amazonTag) {
    const byApp = new Map(
      repo.games.filter((g) => g.status === 'published').map((g) => [g.externalIds.steamAppId, g.id]),
    );
    return {
      source: 'steam',
      fetchedAt: steam.fetchedAt,
      items: steam.items.map((i) => {
        const gameId = byApp.get(i.appId);
        // 家庭用ゲーム機版がないと分かった作品は、Amazon ではなく Steam のストアに向ける
        const pcOnly = i.consoles !== undefined && i.consoles.length === 0;
        return {
          title: i.title,
          url: pcOnly
            ? `https://store.steampowered.com/app/${i.appId}/`
            : amazonSearchUrl(i.title, siteConfig.amazonTag),
          store: pcOnly ? ('steam' as const) : ('amazon' as const),
          ...(i.consoles?.length ? { platform: consoleLabel(i.consoles) } : {}),
          ...(i.image ? { image: { url: i.image, width: 231, height: 87 } } : {}),
          ...(gameId ? { gameId } : {}),
        };
      }),
    };
  }
  return { items: [] };
}

/** 取得から24時間以内の売れ筋だけを読む。なければ undefined */
export function readFreshAmazonRanking(file = AMAZON_RANKING_FILE, at = now()): AmazonRanking | undefined {
  if (!fs.existsSync(file)) return undefined;
  const r = AmazonRanking.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')));
  return r.success && isFresh(r.data, at) ? r.data : undefined;
}

export interface PreparedSite {
  files: Record<string, unknown>; // ファイル名（拡張子なし）→ 内容
  meta: { contentHash: string; hashInputs: HashInputs; generatedAt: string };
}

export function siteEnv(): { SITE_URL: string; BASE_PATH: string } {
  return { SITE_URL: process.env.SITE_URL || 'http://localhost:4321', BASE_PATH: process.env.BASE_PATH || '/' };
}

/** data/ から .generated/site-data/ の内容を作る（03 §3.7） */
export function prepareSite(
  repo: RepoData,
  code: Record<string, string> = codeHashes(),
  amazon?: AmazonRanking,
  steam?: SteamRanking,
): PreparedSite {
  const data = buildSiteData(repo);
  const files: Record<string, unknown> = {
    games: data.games,
    developers: data.developers,
    redirects: data.redirects,
    articles: data.articles,
    collections: data.collections,
    tags: data.tags,
    genres: data.genres,
    events: data.events,
    stats: data.stats,
    // 売れ筋（Amazon は取得から24時間以内、Steam は3日以内のものだけ。なければ空）
    ranking: siteRanking(repo, amazon, steam),
  };
  const hashInputs: HashInputs = { siteData: siteDataHash(files), code, env: siteEnv() };
  return { files, meta: { contentHash: contentHash(hashInputs), hashInputs, generatedAt: toIsoDateTime(now()) } };
}

export function writePreparedSite(site: PreparedSite, dir = SITE_DATA_DIR): void {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, value] of Object.entries(site.files)) {
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(value, null, 2) + '\n');
  }
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(site.meta, null, 2) + '\n');

  // ホストに依存しない中間の形式（08 §8.7）。GitHub Pages では使わない
  const redirects = (site.files.redirects as { from: string; to: string }[]).map((r) => ({
    from: `/games/${r.from}/`,
    to: `/games/${r.to}/`,
    status: 301,
  }));
  const headers = [
    { path: '/_assets/*', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } },
    { path: '/pagefind/*', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } },
  ];
  fs.mkdirSync(HOSTING_DIR, { recursive: true });
  fs.writeFileSync(path.join(HOSTING_DIR, 'redirects.json'), JSON.stringify(redirects, null, 2) + '\n');
  fs.writeFileSync(path.join(HOSTING_DIR, 'headers.json'), JSON.stringify(headers, null, 2) + '\n');
}

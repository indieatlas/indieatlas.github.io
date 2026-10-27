import fs from 'node:fs';
import path from 'node:path';
import { toIsoDateTime, now } from '../lib/clock.ts';
import { PROJECT_ROOT, type RepoData } from '../lib/repo-io.ts';
import { codeHashes, contentHash, siteDataHash, type HashInputs } from './content-hash.ts';
import { buildSiteData } from './site-data.ts';
import { AmazonRanking } from '../../schema/amazon.ts';
import { isFresh } from '../sources/amazon.ts';

export const SITE_DATA_DIR = path.join(PROJECT_ROOT, '.generated/site-data');
export const HOSTING_DIR = path.join(PROJECT_ROOT, '.generated/hosting');
export const AMAZON_RANKING_FILE = path.join(PROJECT_ROOT, '.generated/amazon/ranking.json');

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
    // Amazon の売れ筋（取得から24時間以内のものだけ。なければ空）
    'amazon-ranking': amazon ? { fetchedAt: amazon.fetchedAt, items: amazon.items } : { items: [] },
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

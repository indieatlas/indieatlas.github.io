import fs from 'node:fs';
import path from 'node:path';
import type { FetchResult, HttpClient } from '../../scripts/fetch/http.ts';
import { now } from '../../scripts/lib/clock.ts';
import { sha256Tagged } from '../../scripts/lib/hash.ts';

/**
 * tests/fixtures/web/ のファイルを返す Fake の HTTP クライアント（10 §10.2）。
 * 登録されていない URL を要求されたら例外を投げる。
 */
export function fakeHttp(routes: Record<string, string>): HttpClient & { requested: string[] } {
  const requested: string[] = [];
  return {
    requested,
    async get(url: string): Promise<FetchResult> {
      requested.push(url);
      const file = routes[url];
      if (!file) throw new Error(`fake http: no fixture for ${url}`);
      const text = fs.readFileSync(path.resolve('tests/fixtures/web', file), 'utf8');
      return { url, status: 200, contentType: '', text, fetchHash: sha256Tagged(text), retrievedAt: now() };
    },
  };
}

export function steamRoutes(...appIds: number[]): Record<string, string> {
  const routes: Record<string, string> = {};
  for (const id of appIds) {
    for (const l of ['english', 'japanese']) {
      routes[`https://store.steampowered.com/api/appdetails?appids=${id}&l=${l}&cc=jp`] =
        `steam/appdetails-${id}-${l}.json`;
    }
    const page = path.resolve('tests/fixtures/web/steam', `store-${id}.html`);
    if (fs.existsSync(page))
      routes[`https://store.steampowered.com/app/${id}/?l=english&cc=jp`] = `steam/store-${id}.html`;
  }
  return routes;
}

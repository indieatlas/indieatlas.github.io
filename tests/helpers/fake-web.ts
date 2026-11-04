import fs from 'node:fs';
import path from 'node:path';
import type { Transport, TransportResponse } from '../../scripts/fetch/fetcher.ts';

export interface FakeRoute {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  file?: string; // tests/fixtures/web/ からの相対パス
}

/**
 * tests/fixtures/web/ の内容を返す Fake の Transport（10 §10.2）。登録されていない URL は例外にする。
 * robots.txt だけは、登録がなければ 404（制限なし）を返す。ホスト名は既定で公開のアドレスに解決する。
 */
export function fakeTransport(
  routes: Record<string, FakeRoute>,
  addresses: Record<string, string[]> = {},
): Transport & { requested: string[] } {
  const requested: string[] = [];
  return {
    requested,
    async request(url, _headers, maxBytes): Promise<TransportResponse> {
      requested.push(url);
      const r = routes[url];
      if (!r) {
        if (url.endsWith('/robots.txt')) return { status: 404, headers: {}, body: new Uint8Array() };
        throw new Error(`fake web: no fixture for ${url}`);
      }
      const body = r.file
        ? new Uint8Array(fs.readFileSync(path.resolve('tests/fixtures/web', r.file)))
        : new TextEncoder().encode(r.body ?? '');
      if (body.byteLength > maxBytes) throw new Error(`response too large: ${url}`);
      const type = r.file?.endsWith('.json')
        ? 'application/json'
        : r.file?.endsWith('.xml') || r.file?.endsWith('.rdf')
          ? 'application/xml'
          : 'text/html; charset=utf-8';
      return { status: r.status ?? 200, headers: { 'content-type': type, ...r.headers }, body };
    },
    async resolve(host) {
      return addresses[host] ?? ['93.184.216.34'];
    },
  };
}

import { now } from '../lib/clock.ts';
import { sha256Tagged } from '../lib/hash.ts';

/**
 * 最小限の HTTP 取得。ホストごとの間隔、User-Agent、大きさの上限、http(s) だけの許可を守る。
 * robots.txt、SSRF の防止、本文の抽出などを備えた Fetcher は P2-01 で実装し、置き換える。
 */
export interface FetchResult {
  url: string; // リダイレクト後の URL
  status: number;
  contentType: string;
  text: string;
  bytes: Uint8Array;
  fetchHash: string;
  retrievedAt: Date;
}

export interface HttpClient {
  get(url: string, init?: { headers?: Record<string, string> }): Promise<FetchResult>;
  post?(url: string, body: string, init?: { headers?: Record<string, string> }): Promise<FetchResult>;
}

export interface SimpleHttpOptions {
  userAgent: string;
  minIntervalMs: number;
  timeoutMs: number;
  maxBytes: number;
}

export function createSimpleHttp(opts: SimpleHttpOptions): HttpClient {
  const lastByHost = new Map<string, number>();
  const request = async (method: 'GET' | 'POST', url: string, body?: string, headers?: Record<string, string>) => {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`unsupported protocol: ${url}`);
    // 並行して呼ばれても、同じホストへは順に間隔をあける
    const slot = Math.max(Date.now(), (lastByHost.get(u.host) ?? -Infinity) + opts.minIntervalMs);
    lastByHost.set(u.host, slot);
    const wait = slot - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const res = await fetch(url, {
      method,
      headers: { 'user-agent': opts.userAgent, ...headers },
      ...(body !== undefined ? { body } : {}),
      redirect: 'follow',
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > opts.maxBytes) throw new Error(`response too large: ${url}`);
    const text = new TextDecoder().decode(buf);
    return {
      url: res.url || url,
      status: res.status,
      contentType: res.headers.get('content-type') ?? '',
      text,
      bytes: buf,
      fetchHash: sha256Tagged(buf),
      retrievedAt: now(),
    };
  };
  return {
    get: (url, init) => request('GET', url, undefined, init?.headers),
    post: (url, body, init) => request('POST', url, body, init?.headers),
  };
}

import dns from 'node:dns/promises';
import net from 'node:net';
import robotsParser from 'robots-parser';
import { now, toIsoDateTime } from '../lib/clock.ts';
import { sha256Tagged } from '../lib/hash.ts';
import { extractHtml, squashText } from './extract.ts';

/**
 * 取得のマナーと安全性（05 §5.4.3）を守る Fetcher。
 * robots.txt、ホストごとの間隔、大きさと形式の制限、SSRF の防止（リダイレクトの後も）、
 * 機械学習の利用を拒否する表示の検出、本文の抽出を行う。通信は Transport に任せ、テストでは差し替える。
 */

export interface TransportResponse {
  status: number;
  headers: Record<string, string>; // 名前は小文字
  body: Uint8Array;
}

export interface Transport {
  /** リダイレクトをたどらずに1回だけ取得する。maxBytes を超えたら打ち切って例外を投げる */
  request(
    url: string,
    headers: Record<string, string>,
    maxBytes: number,
    timeoutMs: number,
  ): Promise<TransportResponse>;
  /** ホスト名の IP アドレス */
  resolve(host: string): Promise<string[]>;
}

export type BlockReason = 'robots' | 'noai' | 'private-address' | 'too-large' | 'unsupported-type' | 'protocol';

export interface FetchedPage {
  url: string; // 要求した URL
  finalUrl: string; // リダイレクトの後の URL
  status: number; // 取得しなかった場合は 0
  contentType: string;
  retrievedAt: string; // UTC の ISO 8601
  fetchHash?: string; // 本文のハッシュ
  blocked?: BlockReason;
  error?: string;
  raw?: string; // デコードした応答の全体（フィードと JSON の読み取りに使う。noai のページでは持たない）
  title?: string;
  canonicalUrl?: string;
  publishedAt?: string;
  lang?: string;
  ogImage?: string;
  text: string; // 抽出した本文。noai のページでは空
  links: { url: string; text: string }[];
  noai: boolean;
  etag?: string; // 条件付きリクエスト（If-None-Match）に使う
  lastModified?: string;
}

export interface FetcherOptions {
  userAgent: string;
  timeoutMs: number;
  maxBytes: number;
  minIntervalMs: number;
  maxRedirects?: number;
  /** ホストごとの間隔（情報源の minIntervalMs） */
  intervalFor?: (host: string) => number | undefined;
}

export interface Fetcher {
  fetch(url: string, init?: { headers?: Record<string, string> }): Promise<FetchedPage>;
}

const ALLOWED_TYPES = [
  /^text\/html/,
  /^application\/xhtml\+xml/,
  /^(?:application|text)\/(?:[\w.+-]+\+)?xml/,
  /^application\/(?:[\w.+-]+\+)?json/,
  /^text\/plain/,
];

/** ループバック、プライベート、リンクローカルのアドレス（05 §5.4.3） */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) // CGNAT
    );
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return /^f[cd]/.test(v) || /^fe[89ab]/.test(v); // fc00::/7、fe80::/10
  }
  return true;
}

function charsetOf(contentType: string, bytes: Uint8Array): string {
  const m = /charset=["']?([\w-]+)/i.exec(contentType);
  if (m) return m[1]!.toLowerCase();
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 2048));
  const meta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head) ?? /<\?xml[^>]+encoding=["']([\w-]+)/i.exec(head);
  return meta ? meta[1]!.toLowerCase() : 'utf-8';
}

export function decodeBody(contentType: string, bytes: Uint8Array): string {
  try {
    return new TextDecoder(charsetOf(contentType, bytes)).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

export function createFetcher(transport: Transport, opts: FetcherOptions): Fetcher {
  const lastByHost = new Map<string, number>();
  const robotsByOrigin = new Map<string, Promise<((url: string) => boolean) | 'unreachable'>>();
  const maxRedirects = opts.maxRedirects ?? 5;
  const ua = opts.userAgent;
  const uaToken = ua.split('/')[0]!;

  const wait = async (host: string) => {
    const interval = opts.intervalFor?.(host) ?? opts.minIntervalMs;
    const last = lastByHost.get(host) ?? 0;
    const delay = last + interval - Date.now();
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    lastByHost.set(host, Date.now());
  };

  const checkAddress = async (u: URL): Promise<BlockReason | undefined> => {
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'protocol';
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost')) return 'private-address';
    const ips = net.isIP(host) ? [host] : await transport.resolve(host);
    if (ips.length === 0 || ips.some(isPrivateAddress)) return 'private-address';
    return undefined;
  };

  /** 1回の取得。リダイレクトはたどり、各段で宛先を確かめる */
  const get = async (
    url: string,
    headers: Record<string, string>,
  ): Promise<{ res?: TransportResponse; finalUrl: string; blocked?: BlockReason }> => {
    let current = new URL(url);
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const blocked = await checkAddress(current);
      if (blocked) return { finalUrl: current.toString(), blocked };
      await wait(current.host);
      const res = await transport.request(
        current.toString(),
        { 'user-agent': ua, ...headers },
        opts.maxBytes,
        opts.timeoutMs,
      );
      const location = res.headers['location'];
      if (res.status >= 300 && res.status < 400 && location) {
        current = new URL(location, current);
        continue;
      }
      return { res, finalUrl: current.toString() };
    }
    throw new Error(`too many redirects: ${url}`);
  };

  const robotsFor = (u: URL) => {
    const origin = u.origin;
    let p = robotsByOrigin.get(origin);
    if (!p) {
      p = (async () => {
        const robotsUrl = `${origin}/robots.txt`;
        try {
          const { res, blocked } = await get(robotsUrl, {});
          if (blocked || !res) return 'unreachable' as const;
          // 4xx は制限なし、5xx は取得を控える（RFC 9309 §2.3.1）
          if (res.status >= 500) return 'unreachable' as const;
          if (res.status >= 400) return () => true;
          const robots = robotsParser(robotsUrl, decodeBody(res.headers['content-type'] ?? '', res.body));
          return (target: string) => robots.isAllowed(target, uaToken) !== false;
        } catch {
          return 'unreachable' as const;
        }
      })();
      robotsByOrigin.set(origin, p);
    }
    return p;
  };

  return {
    async fetch(url, init) {
      const retrievedAt = toIsoDateTime(now());
      const base: FetchedPage = {
        url,
        finalUrl: url,
        status: 0,
        contentType: '',
        retrievedAt,
        text: '',
        links: [],
        noai: false,
      };
      let target: URL;
      try {
        target = new URL(url);
      } catch {
        return { ...base, error: 'invalid url' };
      }
      if (target.protocol !== 'http:' && target.protocol !== 'https:') return { ...base, blocked: 'protocol' };
      try {
        const early = await checkAddress(target);
        if (early) return { ...base, blocked: early };
        const robots = await robotsFor(target);
        if (robots === 'unreachable' || !robots(url)) return { ...base, blocked: 'robots' };
        const { res, finalUrl, blocked } = await get(url, init?.headers ?? {});
        if (blocked || !res) return { ...base, finalUrl, blocked: blocked ?? 'private-address' };
        // リダイレクトの先が別のオリジンなら、その robots.txt も守る
        const final = new URL(finalUrl);
        if (final.origin !== target.origin) {
          const r2 = await robotsFor(final);
          if (r2 === 'unreachable' || !r2(finalUrl)) return { ...base, finalUrl, blocked: 'robots' };
        }
        const contentType = (res.headers['content-type'] ?? '').toLowerCase();
        const page: FetchedPage = {
          ...base,
          finalUrl,
          status: res.status,
          contentType,
          fetchHash: sha256Tagged(res.body),
          ...(res.headers['etag'] ? { etag: res.headers['etag'].slice(0, 200) } : {}),
          ...(res.headers['last-modified'] ? { lastModified: res.headers['last-modified'].slice(0, 100) } : {}),
        };
        if (contentType && !ALLOWED_TYPES.some((re) => re.test(contentType)))
          return { ...page, blocked: 'unsupported-type' };
        const xRobots = res.headers['x-robots-tag'] ?? '';
        const headerNoai = /\bnoai\b/i.test(xRobots) || (res.headers['tdm-reservation'] ?? '').trim() === '1';
        const raw = decodeBody(contentType, res.body);
        const isHtml = /html/.test(contentType) || (!contentType && /^\s*<(?:!doctype html|html)/i.test(raw));
        if (!isHtml) {
          if (headerNoai) return { ...page, noai: true, blocked: 'noai' };
          return { ...page, raw, text: /json|xml/.test(contentType) ? '' : squashText(raw) };
        }
        const ex = extractHtml(raw, finalUrl);
        const noai = headerNoai || ex.noai;
        // 機械学習の利用を拒否するページは、本文を LLM に渡さず、根拠にも使わない
        if (noai) return { ...page, noai: true, blocked: 'noai', ...(ex.title ? { title: ex.title } : {}) };
        return {
          ...page,
          raw,
          text: ex.text,
          links: ex.links,
          noai: false,
          ...(ex.title ? { title: ex.title } : {}),
          ...(ex.canonicalUrl ? { canonicalUrl: ex.canonicalUrl } : {}),
          ...(ex.publishedAt ? { publishedAt: ex.publishedAt } : {}),
          ...(ex.lang ? { lang: ex.lang } : {}),
          ...(ex.ogImage ? { ogImage: ex.ogImage } : {}),
        };
      } catch (e) {
        const message = (e as Error).message;
        return { ...base, error: message, ...(/too large/.test(message) ? { blocked: 'too-large' as const } : {}) };
      }
    },
  };
}

/** Node の fetch を使う Transport */
export function nodeTransport(): Transport {
  return {
    async request(url, headers, maxBytes, timeoutMs) {
      const res = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
      const out: Record<string, string> = {};
      res.headers.forEach((v, k) => (out[k.toLowerCase()] = v));
      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared > maxBytes) {
        await res.body?.cancel();
        throw new Error(`response too large: ${url}`);
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (res.body) {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) {
            await reader.cancel();
            throw new Error(`response too large: ${url}`);
          }
          chunks.push(value);
        }
      }
      const body = new Uint8Array(size);
      let off = 0;
      for (const c of chunks) {
        body.set(c, off);
        off += c.byteLength;
      }
      return { status: res.status, headers: out, body };
    },
    async resolve(host) {
      const r = await dns.lookup(host, { all: true });
      return r.map((x) => x.address);
    },
  };
}

/** runtime.json の fetch の設定から User-Agent を作る */
export function botUserAgent(template: string): string {
  return template
    .replace('{SITE_URL}', process.env.SITE_URL || 'http://localhost:4321')
    .replace('{BASE_PATH}', process.env.BASE_PATH || '/');
}

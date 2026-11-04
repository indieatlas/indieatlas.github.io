import { describe, expect, it } from 'vitest';
import { createFetcher, isPrivateAddress } from '../../scripts/fetch/fetcher.ts';
import { fakeTransport, type FakeRoute } from '../helpers/fake-web.ts';

const page = (body: string, extraHead = '') =>
  `<!doctype html><html lang="ja"><head><title>記事</title>${extraHead}</head><body><article><h1>見出し</h1><p>${body}</p><a href="/press">プレスキット</a></article></body></html>`;

function fetcherFor(routes: Record<string, FakeRoute>, addresses: Record<string, string[]> = {}) {
  const t = fakeTransport(routes, addresses);
  return {
    t,
    f: createFetcher(t, { userAgent: 'IndieAtlasBot/0.1', timeoutMs: 1000, maxBytes: 10_000, minIntervalMs: 0 }),
  };
}

describe('isPrivateAddress', () => {
  it('rejects local and private ranges', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '::1',
      'fd00::1',
      '::ffff:10.0.0.1',
    ])
      expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of ['93.184.216.34', '172.32.0.1', '2606:4700::1']) expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe('createFetcher', () => {
  it('extracts the body, title, canonical and links', async () => {
    const { f } = fetcherFor({
      'https://news.example.jp/a/1': {
        body: page(
          '灯台守の少女となり、潮の満ち引きで姿を変える群島を探索する。'.repeat(10),
          '<link rel="canonical" href="https://news.example.jp/a/1"><meta property="article:published_time" content="2026-10-20T10:00:00+09:00">',
        ),
      },
    });
    const r = await f.fetch('https://news.example.jp/a/1');
    expect(r.status).toBe(200);
    expect(r.title).toBe('記事');
    expect(r.canonicalUrl).toBe('https://news.example.jp/a/1');
    expect(r.publishedAt).toBe('2026-10-20T01:00:00Z');
    expect(r.lang).toBe('ja');
    expect(r.text).toContain('灯台守の少女となり');
    expect(r.links.map((l) => l.url)).toContain('https://news.example.jp/press');
  });

  it('refuses a redirect to a private address', async () => {
    const { f } = fetcherFor(
      {
        'https://news.example.jp/a/2': { status: 302, headers: { location: 'http://internal.example.jp/admin' } },
      },
      { 'internal.example.jp': ['10.0.0.5'] },
    );
    const r = await f.fetch('https://news.example.jp/a/2');
    expect(r.blocked).toBe('private-address');
    expect(r.text).toBe('');
  });

  it('refuses localhost and non-http schemes', async () => {
    const { f } = fetcherFor({});
    expect((await f.fetch('http://localhost:8080/')).blocked).toBe('private-address');
    expect((await f.fetch('file:///etc/passwd')).blocked).toBe('protocol');
  });

  it('does not fetch paths disallowed by robots.txt', async () => {
    const { f, t } = fetcherFor({
      'https://news.example.jp/robots.txt': {
        body: 'User-agent: *\nDisallow: /private/\n',
        headers: { 'content-type': 'text/plain' },
      },
      'https://news.example.jp/ok': { body: page('本文') },
    });
    expect((await f.fetch('https://news.example.jp/private/x')).blocked).toBe('robots');
    expect(t.requested).not.toContain('https://news.example.jp/private/x');
    expect((await f.fetch('https://news.example.jp/ok')).status).toBe(200);
  });

  it('stays away from a host whose robots.txt returns 5xx', async () => {
    const { f } = fetcherFor({ 'https://down.example.jp/robots.txt': { status: 503 } });
    expect((await f.fetch('https://down.example.jp/a')).blocked).toBe('robots');
  });

  it('does not return the body of noai pages', async () => {
    const { f } = fetcherFor({
      'https://news.example.jp/meta': { body: page('秘密の本文', '<meta name="robots" content="index, noai">') },
      'https://news.example.jp/header': { body: page('秘密の本文'), headers: { 'x-robots-tag': 'noai, noimageai' } },
      'https://news.example.jp/tdm': { body: page('秘密の本文', '<meta name="tdm-reservation" content="1">') },
    });
    for (const u of ['https://news.example.jp/meta', 'https://news.example.jp/header', 'https://news.example.jp/tdm']) {
      const r = await f.fetch(u);
      expect(r.noai).toBe(true);
      expect(r.blocked).toBe('noai');
      expect(r.text).toBe('');
      expect(r.raw).toBeUndefined();
    }
  });

  it('rejects unsupported types and oversized bodies', async () => {
    const { f } = fetcherFor({
      'https://cdn.example.jp/a.zip': { body: 'x', headers: { 'content-type': 'application/zip' } },
      'https://news.example.jp/big': { body: 'x'.repeat(20_000) },
    });
    expect((await f.fetch('https://cdn.example.jp/a.zip')).blocked).toBe('unsupported-type');
    expect((await f.fetch('https://news.example.jp/big')).blocked).toBe('too-large');
  });
});

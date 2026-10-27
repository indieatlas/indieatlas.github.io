import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkDist } from '../../scripts/build/dist-checks.ts';

let tmp: string;
let dist: string;
let site: string;
const BASE = '/indieatlas/';
const SITE = 'https://example.github.io';
const HASH = 'sha256:' + 'c'.repeat(64);

function page(body: string, extra = ''): string {
  return `<!doctype html><html lang="ja"><head><title>t</title><link rel="canonical" href="${SITE}${BASE}">${extra}</head><body>${body}</body></html>`;
}
function write(rel: string, text: string) {
  const f = path.join(dist, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-dist-'));
  dist = path.join(tmp, 'dist');
  site = path.join(tmp, 'site');
  fs.mkdirSync(site);
  fs.writeFileSync(path.join(site, 'games.json'), JSON.stringify([{ id: 'g_000001' }]));
  fs.writeFileSync(path.join(site, 'redirects.json'), JSON.stringify([{ from: 'g_000002', to: 'g_000001' }]));
  fs.writeFileSync(path.join(site, 'meta.json'), JSON.stringify({ contentHash: HASH }));
  write('index.html', page(`<a href="${BASE}games/">games</a><img src="${BASE}_assets/a.svg">`));
  write('_assets/a.svg', '<svg/>');
  write('games/index.html', page(`<a href="${BASE}games/g_000001/">x</a>`));
  write('games/g_000001/index.html', page('<p>x</p>'));
  write(
    'games/g_000002/index.html',
    page('', `<meta http-equiv="refresh" content="0; url=${SITE}${BASE}games/g_000001/">`),
  );
  write('404.html', page(''));
  write('atlas.json', JSON.stringify({ v: 1, points: [] }));
  write('pagefind/pagefind.js', 'export {}');
  write('sitemap-index.xml', `<sitemapindex><sitemap><loc>${SITE}${BASE}sitemap-0.xml</loc></sitemap></sitemapindex>`);
  write('robots.txt', 'User-agent: *');
  write(
    'build-manifest.json',
    JSON.stringify({
      schemaVersion: 1,
      site: 'Indie Atlas',
      contentHash: HASH,
      hashInputs: { siteData: HASH, code: {}, env: { SITE_URL: SITE, BASE_PATH: BASE } },
      sourceCommit: 'x',
      triggerCommit: 'x',
      runId: 'local',
      runAttempt: 1,
      workflow: 'local',
      builtAt: '2026-10-27T00:00:00Z',
      siteUrl: SITE,
      basePath: BASE,
      counts: { games: 1, articles: 0, collections: 0 },
      distBytes: 1,
    }),
  );
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const run = () =>
  checkDist({ distDir: dist, siteDataDir: site, siteUrl: SITE, basePath: BASE }).filter((i) => i.level === 'error');
const rules = () => run().map((i) => i.rule);

describe('check:dist（07 §7.5）', () => {
  it('正しい成果物で通る', () => {
    expect(run()).toEqual([]);
  });
  it('B-01: 必要なファイルがない', () => {
    fs.rmSync(path.join(dist, 'robots.txt'));
    expect(rules()).toContain('B-01');
  });
  it('B-02: 公開中の作品のページがない', () => {
    fs.rmSync(path.join(dist, 'games/g_000001'), { recursive: true });
    expect(rules()).toContain('B-02');
  });
  it('B-03: ベースパスのないリンク', () => {
    write('about/index.html', page('<a href="/games/">x</a>'));
    expect(rules()).toContain('B-03');
  });
  it('B-03: 解決できない内部リンク', () => {
    write('about/index.html', page(`<a href="${BASE}nowhere/">x</a>`));
    expect(rules()).toContain('B-03');
  });
  it('B-04: canonical がサイトの外', () => {
    write('about/index.html', page('').replace(`${SITE}${BASE}`, `${SITE}/`));
    expect(rules()).toContain('B-04');
  });
  it('B-05: lang がない', () => {
    write('about/index.html', '<html><title>t</title></html>');
    expect(rules()).toContain('B-05');
  });
  it('B-06: 根拠の抜粋を含む JSON', () => {
    write('data.json', JSON.stringify([{ evidence: [{ quote: 'secret quote' }] }]));
    expect(rules()).toContain('B-06');
  });
  it('B-06: 機密情報らしい文字列', () => {
    write('x.js', 'const k = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";');
    expect(rules()).toContain('B-06');
  });
  it('B-08: contentHash が meta.json と異なる', () => {
    fs.writeFileSync(path.join(site, 'meta.json'), JSON.stringify({ contentHash: 'sha256:' + 'd'.repeat(64) }));
    expect(rules()).toContain('B-08');
  });
});

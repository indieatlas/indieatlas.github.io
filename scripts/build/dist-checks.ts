import fs from 'node:fs';
import path from 'node:path';
import { BuildManifest } from '../../schema/manifest.ts';
import { SECRET_PATTERN } from '../lib/secrets.ts';

export interface DistIssue {
  rule: string; // B-01 など
  file?: string;
  message: string;
  level: 'error' | 'warn';
}

export interface DistCheckOptions {
  distDir: string;
  siteDataDir: string;
  siteUrl: string;
  basePath: string;
}

const REQUIRED = [
  'index.html',
  'games/index.html',
  '404.html',
  'build-manifest.json',
  'atlas.json',
  'pagefind/pagefind.js',
  'sitemap-index.xml',
  'robots.txt',
];
const FORBIDDEN_KEYS = ['quote', 'quoteHash', 'identityEvidence', 'disambiguation'];
const MB = 1024 * 1024;

function* walk(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function hasKeyDeep(v: unknown, keys: string[]): string | undefined {
  if (Array.isArray(v)) {
    for (const x of v) {
      const k = hasKeyDeep(x, keys);
      if (k) return k;
    }
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (keys.includes(k)) return k;
      const found = hasKeyDeep(x, keys);
      if (found) return found;
    }
  }
  return undefined;
}

/** dist/ の中のパスに解決する。見つからなければ undefined */
function resolveInDist(distDir: string, urlPath: string): string | undefined {
  const clean = decodeURIComponent(urlPath.split(/[?#]/)[0]!);
  const candidates = clean.endsWith('/') ? [path.join(clean, 'index.html')] : [clean, path.join(clean, 'index.html')];
  for (const c of candidates) {
    const abs = path.join(distDir, c);
    if (abs.startsWith(distDir) && fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  }
  return undefined;
}

const ATTR_RE = /\s(href|src|srcset|content)\s*=\s*"([^"]*)"/g;

/** 公開前の検証（07 §7.5 の B-01〜B-08） */
export function checkDist(o: DistCheckOptions): DistIssue[] {
  const issues: DistIssue[] = [];
  const add = (rule: string, message: string, file?: string, level: 'error' | 'warn' = 'error') =>
    issues.push({ rule, message, level, ...(file ? { file } : {}) });
  const rel = (f: string) => path.relative(o.distDir, f);
  const origin = o.siteUrl.replace(/\/$/, '');
  const prefix = origin + o.basePath;

  // B-01
  for (const f of REQUIRED) if (!fs.existsSync(path.join(o.distDir, f))) add('B-01', `missing ${f}`);

  // B-02
  const games = JSON.parse(fs.readFileSync(path.join(o.siteDataDir, 'games.json'), 'utf8')) as { id: string }[];
  for (const g of games) {
    if (!fs.existsSync(path.join(o.distDir, 'games', g.id, 'index.html'))) add('B-02', `missing page for ${g.id}`);
  }
  const redirects = JSON.parse(fs.readFileSync(path.join(o.siteDataDir, 'redirects.json'), 'utf8')) as {
    from: string;
    to: string;
  }[];
  for (const r of redirects) {
    const f = path.join(o.distDir, 'games', r.from, 'index.html');
    if (!fs.existsSync(f)) add('B-02', `missing redirect page for ${r.from}`);
    else if (!fs.readFileSync(f, 'utf8').includes(`${prefix}games/${r.to}/`))
      add('B-02', `redirect ${r.from} does not point to ${r.to}`, rel(f));
  }

  let total = 0;
  for (const file of walk(o.distDir)) {
    const size = fs.statSync(file).size;
    total += size;
    // B-07（1ファイル）
    if (size > 50 * MB) add('B-07', `file larger than 50MB (${size} bytes)`, rel(file));
    const ext = path.extname(file);
    if (!['.html', '.json', '.js', '.mjs', '.css', '.xml', '.txt', '.svg'].includes(ext)) continue;
    const text = fs.readFileSync(file, 'utf8');
    // B-06
    if (SECRET_PATTERN.test(text)) add('B-06', 'contains a secret-like string', rel(file));
    if (ext === '.json') {
      try {
        const key = hasKeyDeep(JSON.parse(text), FORBIDDEN_KEYS);
        if (key) add('B-06', `JSON contains forbidden key "${key}"`, rel(file));
      } catch {
        add('B-06', 'invalid JSON', rel(file));
      }
    }
    if (ext === '.xml' && /sitemap/.test(path.basename(file))) {
      // B-04（sitemap）
      for (const m of text.matchAll(/<loc>([^<]+)<\/loc>/g)) {
        if (!m[1]!.startsWith(prefix)) add('B-04', `sitemap URL outside the site: ${m[1]}`, rel(file));
      }
    }
    if (ext !== '.html') continue;
    // B-05
    if (!/<html[^>]*\slang="ja"/.test(text)) add('B-05', 'missing <html lang="ja">', rel(file));
    if (!/<title>[^<]+<\/title>/.test(text)) add('B-05', 'missing <title>', rel(file));
    // B-04（canonical と OGP）
    const canonical = text.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
    if (canonical && !canonical.startsWith(prefix)) add('B-04', `canonical outside the site: ${canonical}`, rel(file));
    const ogUrl = text.match(/<meta property="og:url" content="([^"]+)"/)?.[1];
    if (ogUrl && !ogUrl.startsWith(prefix)) add('B-04', `og:url outside the site: ${ogUrl}`, rel(file));
    const ogImage = text.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
    if (ogImage && ogImage.startsWith(origin) && !ogImage.startsWith(prefix))
      add('B-04', `og:image outside the base path: ${ogImage}`, rel(file));
    // B-03（内部リンク）
    const html = text.replace(/<script[\s\S]*?<\/script>/g, '');
    for (const m of html.matchAll(ATTR_RE)) {
      const [, attr, value] = m;
      if (attr === 'content') continue;
      const urls = attr === 'srcset' ? value!.split(',').map((s) => s.trim().split(/\s+/)[0]!) : [value!];
      for (const u of urls) {
        if (!u || /^(https?:|mailto:|data:|#|javascript:)/.test(u) || u.startsWith('//')) continue;
        let target: string;
        if (u.startsWith('/')) {
          if (!u.startsWith(o.basePath)) {
            add('B-03', `link without base path: ${u}`, rel(file));
            continue;
          }
          target = '/' + u.slice(o.basePath.length);
        } else {
          target = path.posix.join('/', path.posix.dirname('/' + rel(file).split(path.sep).join('/')), u);
        }
        if (!resolveInDist(o.distDir, target)) add('B-03', `broken internal link: ${u}`, rel(file));
      }
    }
  }

  // B-07（合計）
  if (total > 800 * MB) add('B-07', `dist is ${Math.round(total / MB)}MB (> 800MB)`);
  else if (total > 500 * MB) add('B-07', `dist is ${Math.round(total / MB)}MB (> 500MB)`, undefined, 'warn');

  // B-08
  const manifestFile = path.join(o.distDir, 'build-manifest.json');
  if (fs.existsSync(manifestFile)) {
    const parsed = BuildManifest.safeParse(JSON.parse(fs.readFileSync(manifestFile, 'utf8')));
    if (!parsed.success)
      add('B-08', `build-manifest.json does not match the schema: ${parsed.error.issues[0]?.message}`);
    else {
      const meta = JSON.parse(fs.readFileSync(path.join(o.siteDataDir, 'meta.json'), 'utf8')) as {
        contentHash: string;
      };
      if (parsed.data.contentHash !== meta.contentHash)
        add('B-08', 'contentHash differs from .generated/site-data/meta.json');
    }
  }
  return issues;
}

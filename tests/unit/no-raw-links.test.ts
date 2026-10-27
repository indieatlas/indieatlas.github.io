import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// コンポーネントとページに "/" 始まりのリンクを直接書かない。必ず url() を通す（08 §8.2）
const RAW = [
  /\b(?:href|src|srcset|action|poster)\s*=\s*["'`]\/(?!\/)/, // href="/..."
  /\b(?:href|src|srcset|action|poster)\s*=\s*\{\s*["'`]\/(?!\/)/, // href={'/...'}
  /\bfetch\(\s*["'`]\/(?!\/)/, // fetch('/...')
  /\bimport\(\s*["'`]\/(?!\/)/, // import('/...')
  /location\.href\s*=\s*["'`]\/(?!\/)/,
];
const ALLOW = new Set(['src/lib/urls.ts']);

function* walk(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(astro|ts|tsx|js|mjs|md)$/.test(e.name)) yield p;
  }
}

describe('生のリンクを禁じる', () => {
  const files = [...walk('src')].filter((f) => !ALLOW.has(f.split(path.sep).join('/')));
  it('src/ を走査する', () => {
    expect(files.length).toBeGreaterThan(10);
  });
  for (const file of files) {
    it(file, () => {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      const bad = lines
        .map((l, i) => ({ l, i: i + 1 }))
        .filter(({ l }) => RAW.some((re) => re.test(l)))
        .map(({ l, i }) => `${i}: ${l.trim()}`);
      expect(bad).toEqual([]);
    });
  }
});

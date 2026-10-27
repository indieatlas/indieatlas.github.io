import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { codeHashes } from '../../scripts/build/content-hash.ts';
import { buildManifest } from '../../scripts/build/manifest.ts';
import { prepareSite, writePreparedSite } from '../../scripts/build/prepare-site.ts';
import { loadRepo } from '../../scripts/lib/repo-io.ts';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-manifest-'));
  process.env.INDIEATLAS_ROOT = path.resolve('tests/fixtures/repo');
  process.env.INDIEATLAS_NOW = '2026-10-27T01:00:00Z';
});
afterEach(() => {
  delete process.env.INDIEATLAS_ROOT;
  delete process.env.INDIEATLAS_NOW;
  delete process.env.SOURCE_COMMIT;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('build-manifest.json（07 §7.4、受入基準7）', () => {
  it('sourceCommit はビルドしたコミットで、そのコミットから計算し直した contentHash と一致する', () => {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    process.env.SOURCE_COMMIT = head;
    const site = prepareSite(loadRepo());
    const siteDir = path.join(tmp, 'site-data');
    const dist = path.join(tmp, 'dist');
    fs.mkdirSync(dist);
    fs.writeFileSync(path.join(dist, 'index.html'), '<html lang="ja"><title>x</title></html>');
    writePreparedSite(site, siteDir);
    const m = buildManifest(siteDir, dist);
    expect(m.sourceCommit).toBe(head);
    expect(m.contentHash).toBe(site.meta.contentHash);
    // 同じコミットと同じデータからは同じハッシュになる
    const again = prepareSite(loadRepo(), codeHashes(head));
    expect(again.meta.contentHash).toBe(m.contentHash);
    expect(m.counts.games).toBe(6);
    expect(m.distBytes).toBeGreaterThan(0);
  });
});

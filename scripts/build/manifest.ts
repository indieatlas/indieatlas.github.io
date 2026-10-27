import fs from 'node:fs';
import path from 'node:path';
import { BuildManifest } from '../../schema/manifest.ts';
import { nowIso } from '../lib/clock.ts';
import { siteEnv } from './prepare-site.ts';
import { sourceCommit } from './content-hash.ts';

export function distBytes(dir: string): number {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? distBytes(p) : fs.statSync(p).size;
  }
  return total;
}

/** dist/build-manifest.json の内容（07 §7.4.2） */
export function buildManifest(siteDataDir: string, distDir: string): BuildManifest {
  const meta = JSON.parse(fs.readFileSync(path.join(siteDataDir, 'meta.json'), 'utf8'));
  const stats = JSON.parse(fs.readFileSync(path.join(siteDataDir, 'stats.json'), 'utf8'));
  const env = siteEnv();
  const commit = sourceCommit();
  return BuildManifest.parse({
    schemaVersion: 1,
    site: 'Indie Atlas',
    contentHash: meta.contentHash,
    hashInputs: meta.hashInputs,
    sourceCommit: commit,
    triggerCommit: process.env.TRIGGER_COMMIT ?? commit,
    runId: process.env.RUN_ID ?? 'local',
    runAttempt: Number(process.env.RUN_ATTEMPT ?? '1'),
    workflow: process.env.GITHUB_WORKFLOW ?? 'local',
    builtAt: nowIso(),
    siteUrl: env.SITE_URL,
    basePath: env.BASE_PATH,
    counts: { games: stats.games, articles: stats.articles, collections: stats.collections },
    distBytes: distBytes(distDir),
  });
}

import fs from 'node:fs';
import path from 'node:path';
import { buildManifest } from '../build/manifest.ts';
import { SITE_DATA_DIR } from '../build/prepare-site.ts';
import { runMain } from '../lib/errors.ts';
import { PROJECT_ROOT } from '../lib/repo-io.ts';

// dist/build-manifest.json を書く（07 §7.4）
await runMain(() => {
  const dist = path.join(PROJECT_ROOT, 'dist');
  const manifest = buildManifest(SITE_DATA_DIR, dist);
  fs.writeFileSync(path.join(dist, 'build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`finalize-dist: ${manifest.contentHash} (${manifest.counts.games} games, ${manifest.distBytes} bytes)`);
});

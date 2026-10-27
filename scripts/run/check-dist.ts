import path from 'node:path';
import { checkDist } from '../build/dist-checks.ts';
import { siteEnv, SITE_DATA_DIR } from '../build/prepare-site.ts';
import { runMain } from '../lib/errors.ts';
import { PROJECT_ROOT } from '../lib/repo-io.ts';

// 公開前の検証（07 §7.5）
await runMain(() => {
  const env = siteEnv();
  const issues = checkDist({
    distDir: path.join(PROJECT_ROOT, 'dist'),
    siteDataDir: SITE_DATA_DIR,
    siteUrl: env.SITE_URL,
    basePath: env.BASE_PATH,
  });
  for (const i of issues) console.error(`${i.level === 'warn' ? 'warn ' : ''}${i.rule} ${i.file ?? ''}: ${i.message}`);
  const errors = issues.filter((i) => i.level === 'error');
  if (errors.length > 0) {
    console.error(`check:dist: ${errors.length} error(s)`);
    process.exit(1);
  }
  console.log(`check:dist: ok (${env.SITE_URL}${env.BASE_PATH})`);
});

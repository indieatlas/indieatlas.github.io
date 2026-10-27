import { runMain } from '../lib/errors.ts';
import { repoRoot } from '../lib/repo-io.ts';
import { checkData } from '../pipeline/data-checks.ts';

// data/、state/、config/ 全体のスキーマ、参照、並び順を検証する（04 §4.10）
await runMain(() => {
  const issues = checkData();
  for (const i of issues) console.error(`${i.rule} ${i.file ?? ''}: ${i.message}`);
  if (issues.length > 0) {
    console.error(`check:data: ${issues.length} issue(s) in ${repoRoot()}`);
    process.exit(1);
  }
  console.log(`check:data: ok (${repoRoot()})`);
});

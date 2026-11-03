import { nowIso } from '../lib/clock.ts';
import { runMain } from '../lib/errors.ts';
import { fileKind, loadRepo, repoPath, writeKind } from '../lib/repo-io.ts';
import { repointCollections } from '../pipeline/claim-refs.ts';

// 置き換えられた Claim を参照するコレクションの項目を、置き換えた先の Claim に付け替える
//   npm run claims:repoint
await runMain(() => {
  const changed = repointCollections(loadRepo(), nowIso());
  for (const col of changed) writeKind(fileKind('collection'), repoPath(`data/collections/${col.id}.json`), col);
  console.log(
    `claims:repoint: ${changed.length} collection(s)${changed.length ? ` (${changed.map((c) => c.id).join(', ')})` : ''}`,
  );
});

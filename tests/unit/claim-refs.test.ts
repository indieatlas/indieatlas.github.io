import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadRepo, type RepoData } from '../../scripts/lib/repo-io.ts';
import { repointCollections } from '../../scripts/pipeline/claim-refs.ts';

let repo: RepoData;
beforeAll(() => {
  process.env.INDIEATLAS_ROOT = path.resolve('tests/fixtures/repo');
  repo = loadRepo();
});
afterAll(() => {
  delete process.env.INDIEATLAS_ROOT;
});

describe('claims:repoint', () => {
  it('置き換えられた Claim を参照するコレクションの項目を、置き換えた先に付け替える', () => {
    const r = structuredClone(repo);
    const col = r.collections.find((c) => c.items.some((i) => i.evidenceClaimIds.length > 0))!;
    const item = col.items.find((i) => i.evidenceClaimIds.length > 0)!;
    const oldId = item.evidenceClaimIds[0]!;
    const file = [...r.claims.values()].find((f) => f.claims.some((c) => c.id === oldId))!;
    const claim = file.claims.find((c) => c.id === oldId)!;
    claim.status = 'superseded';
    claim.supersededBy = 'c_0000000000000001';

    const changed = repointCollections(r, '2026-11-03T00:00:00Z');
    expect(changed.map((c) => c.id)).toEqual([col.id]);
    const updated = changed[0]!.items.find((i) => i.gameId === item.gameId)!;
    expect(updated.evidenceClaimIds).toContain('c_0000000000000001');
    expect(updated.evidenceClaimIds).not.toContain(oldId);
    expect(repointCollections(repo, '2026-11-03T00:00:00Z')).toEqual([]);
  });
});

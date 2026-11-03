import type { Collection } from '../../schema/collection.ts';
import type { RepoData } from '../lib/repo-io.ts';

/**
 * 置き換えられた（superseded）Claim を理由の根拠にしているコレクションの項目を、置き換えた先の Claim に付け替える。
 * seed:steam や発売情報の更新で Claim が置き換わると、check:data の D-09 で止まるのを防ぐ（12 §12.6.7）
 */
export function repointCollections(repo: RepoData, at: string): Collection[] {
  const next = new Map<string, string>();
  for (const f of repo.claims.values()) {
    for (const c of f.claims) if (c.status === 'superseded' && c.supersededBy) next.set(c.id, c.supersededBy);
  }
  const follow = (id: string) => {
    const visited = new Set<string>();
    while (next.has(id) && !visited.has(id)) {
      visited.add(id);
      id = next.get(id)!;
    }
    return id;
  };
  const changed: Collection[] = [];
  for (const col of repo.collections) {
    let touched = false;
    const items = col.items.map((item) => {
      const ids = [...new Set(item.evidenceClaimIds.map(follow))];
      if (ids.join() === item.evidenceClaimIds.join()) return item;
      touched = true;
      return { ...item, evidenceClaimIds: ids };
    });
    if (touched) changed.push({ ...col, items, updatedAt: at });
  }
  return changed;
}

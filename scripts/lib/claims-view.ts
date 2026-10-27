import type { Claim, ClaimOf } from '../../schema/claim.ts';
import type { CollectionRules } from '../../schema/collection.ts';
import type { Platform, PlayerMode, ReleaseStatus, Support } from '../../schema/common.ts';

/** 採用済みの Claim から読める、作品の分類と絞り込み用の値 */
export interface ClaimsView {
  tagIds: string[];
  platforms: Platform[];
  releaseStatuses: ReleaseStatus[];
  japaneseInterface: Support[];
  playerModes: PlayerMode[];
}

export function adoptedOf<F extends Claim['field']>(claims: Claim[], field: F): ClaimOf<F>[] {
  return claims.filter((c): c is ClaimOf<F> => c.field === field && c.status === 'adopted');
}

export function claimsView(claims: Claim[]): ClaimsView {
  const releases = adoptedOf(claims, 'release');
  const platforms = new Set<Platform>();
  for (const r of releases) {
    if (r.value.status !== 'cancelled' && r.value.status !== 'delisted' && r.scope.platform) {
      platforms.add(r.scope.platform);
    }
  }
  for (const s of adoptedOf(claims, 'storeLink')) if (s.scope.platform) platforms.add(s.scope.platform);
  return {
    tagIds: [...new Set(adoptedOf(claims, 'tag').map((c) => c.value.tagId))],
    platforms: [...platforms],
    releaseStatuses: [...new Set(releases.map((r) => r.value.status))],
    japaneseInterface: [...new Set(adoptedOf(claims, 'japaneseSupport').map((c) => c.value.interface))],
    playerModes: [...new Set(adoptedOf(claims, 'playerModes').flatMap((c) => c.value.modes))],
  };
}

const intersects = <T>(a: readonly T[], b: readonly T[]) => a.some((x) => b.includes(x));

/** コレクションの rules を満たすか（04 §4.7.1） */
export function matchesRules(view: ClaimsView, rules: CollectionRules | undefined): boolean {
  if (!rules) return true;
  if (rules.allTags && !rules.allTags.every((t) => view.tagIds.includes(t))) return false;
  if (rules.anyTags && !intersects(rules.anyTags, view.tagIds)) return false;
  if (rules.excludeTags && intersects(rules.excludeTags, view.tagIds)) return false;
  if (rules.platforms && !intersects(rules.platforms, view.platforms)) return false;
  if (rules.releaseStatuses && !intersects(rules.releaseStatuses, view.releaseStatuses)) return false;
  if (rules.japaneseInterface && !intersects(rules.japaneseInterface, view.japaneseInterface)) return false;
  if (rules.playerModes && !intersects(rules.playerModes, view.playerModes)) return false;
  return true;
}

import type { SiteGame } from '../../schema/site-data.ts';
import { japaneseBadge, JAPANESE_BADGE_LABELS, PLATFORM_LABELS, PLAYER_MODE_LABELS } from './format.ts';

/** 検索の絞り込みに使う値（03 §3.6） */
export function pagefindFilters(g: SiteGame): Record<string, string[]> {
  return {
    tag: g.tags.map((t) => t.id),
    platform: g.platforms,
    release: g.release && !g.release.conflicted ? [g.release.overall.status] : ['unknown'],
    ja: [jaFilterValue(g)],
    mode: g.playerModes?.modes ?? [],
  };
}

export function jaFilterValue(g: SiteGame): string {
  const b = japaneseBadge(g.japaneseSupport);
  return b === 'full'
    ? 'yes'
    : b === 'partial'
      ? 'partial'
      : b === 'planned'
        ? 'planned'
        : b === 'none'
          ? 'no'
          : 'unknown';
}

export const FILTER_VALUE_LABELS: Record<string, Record<string, string>> = {
  platform: PLATFORM_LABELS,
  release: {
    released: '発売中',
    'early-access': '早期アクセス',
    upcoming: '発売予定',
    tba: '発売日未定',
    cancelled: '開発中止',
    delisted: '配信終了',
    unknown: '不明',
  },
  ja: {
    yes: JAPANESE_BADGE_LABELS.full,
    partial: JAPANESE_BADGE_LABELS.partial,
    planned: '対応予定',
    no: '非対応',
    unknown: '不明',
  },
  mode: PLAYER_MODE_LABELS,
};

/** 発売日の並び替えのキー（YYYY-MM-DD）。発売日不明は空 */
export function releasedSortKey(g: SiteGame): string {
  return g.release?.overall.sortKey ?? '';
}

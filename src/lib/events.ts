import type { SiteEvent } from '../../schema/site-data.ts';

export const EVENT_KIND_LABELS: Record<string, string> = {
  exhibition: '展示・試遊',
  showcase: '発表配信',
  festival: 'オンラインフェス',
  conference: 'カンファレンス',
  awards: 'アワード',
  'game-jam': 'ゲームジャム',
  sale: 'セール',
  other: 'その他',
};

/** 絞り込みの種類（いくつかの種類をまとめる） */
export const EVENT_GROUPS = [
  { id: 'exhibition', label: '展示・試遊' },
  { id: 'showcase', label: '発表・アワード' },
  { id: 'festival', label: 'フェス・セール' },
  { id: 'conference', label: 'カンファレンス' },
] as const;

export function eventGroup(kind: string): string {
  if (kind === 'exhibition') return 'exhibition';
  if (kind === 'showcase' || kind === 'awards') return 'showcase';
  if (kind === 'festival' || kind === 'sale') return 'festival';
  return 'conference';
}

export const EVENT_REGIONS = [
  { id: 'jp', label: '国内' },
  { id: 'overseas', label: '海外' },
  { id: 'online', label: 'オンライン' },
] as const;

export function eventRegion(e: SiteEvent): string {
  if (e.format === 'online') return 'online';
  return !e.location?.country || e.location.country === 'JP' ? 'jp' : 'overseas';
}

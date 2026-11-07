import type { SiteEvent } from '../../schema/site-data.ts';

export const EVENT_KIND_LABELS: Record<string, string> = {
  exhibition: '展示・試遊',
  showcase: '発表配信',
  festival: 'フェス',
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

/** 会場で開く催し（配信もある hybrid を含む）。サイトではオンラインの催しと分けて、こちらを大きく見せる */
export function isVenueEvent(e: Pick<SiteEvent, 'format'>): boolean {
  return e.format !== 'online';
}

export const EVENT_FORMAT_LABELS: Record<SiteEvent['format'], string> = {
  'in-person': '会場',
  hybrid: '会場・配信',
  online: 'オンライン',
};

/** 会場の表記。会場の催しで会場が分からなければ「会場未定」 */
export function eventPlace(e: Pick<SiteEvent, 'format' | 'location'>, short = false): string {
  if (e.format === 'online') return 'オンライン';
  if (!e.location) return '会場未定';
  if (short) return e.location.city ?? e.location.venue;
  return [e.location.venue, e.location.city].filter(Boolean).join('・');
}

export const REPORT_PLATFORM_LABELS: Record<SiteEvent['reports'][number]['platform'], string> = {
  note: 'note',
  'hatena-blog': 'はてなブログ',
  blog: 'ブログ',
};

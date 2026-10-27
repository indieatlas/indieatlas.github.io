import type { ArticleKind, ArticleRole, PartialDate, PlayerMode, Support } from '../../schema/common.ts';
import { PLATFORM_LABELS, STORE_LABELS } from '../../scripts/build/labels.ts';
import { format as formatPartial } from '../../scripts/lib/partial-date.ts';

export { PLATFORM_LABELS, STORE_LABELS };

const JST = 'Asia/Tokyo';

function parts(iso: string): { y: number; m: number; d: number } {
  // YYYY-MM-DD は日本時間の暦日としてそのまま読む。日時は日本時間に直す
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split('-').map(Number);
    return { y: y!, m: m!, d: d! };
  }
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: JST, year: 'numeric', month: '2-digit', day: '2-digit' });
  const [y, m, d] = f.format(new Date(iso)).split('-').map(Number);
  return { y: y!, m: m!, d: d! };
}

/** 収録日、確認日、掲載日: YYYY年M月D日 */
export function formatDate(iso: string): string {
  const { y, m, d } = parts(iso);
  return `${y}年${m}月${d}日`;
}

/** カードでの表記: YYYY/MM/DD */
export function formatCardDate(iso: string): string {
  const { y, m, d } = parts(iso);
  return `${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
}

/** datetime 属性用の YYYY-MM-DD */
export function isoDate(iso: string): string {
  const { y, m, d } = parts(iso);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function formatPartialDate(d: PartialDate): string {
  return formatPartial(d);
}

export const SUPPORT_LABELS: Record<Support, string> = {
  yes: '対応',
  no: '非対応',
  planned: '対応予定',
  unknown: '不明',
};

export type JapaneseBadge = 'full' | 'partial' | 'planned' | 'none' | 'unknown';

/** カードのバッジ: 対応、一部、対応予定、非対応、不明 */
export function japaneseBadge(ja: { interface: Support; subtitles: Support; audio: Support } | null): JapaneseBadge {
  if (!ja) return 'unknown';
  if (ja.interface === 'yes') return 'full';
  if (ja.subtitles === 'yes' || ja.audio === 'yes') return 'partial';
  if (ja.interface === 'planned') return 'planned';
  if (ja.interface === 'no') return 'none';
  return 'unknown';
}

export const JAPANESE_BADGE_LABELS: Record<JapaneseBadge, string> = {
  full: '対応',
  partial: '一部',
  planned: '対応予定',
  none: '非対応',
  unknown: '不明',
};

export const PLAYER_MODE_LABELS: Record<PlayerMode, string> = {
  single: 'シングルプレイ',
  'local-coop': 'ローカル協力',
  'online-coop': 'オンライン協力',
  'local-pvp': 'ローカル対戦',
  'online-pvp': 'オンライン対戦',
  async: '非同期',
  mmo: 'MMO',
};

export const ARTICLE_KIND_LABELS: Record<ArticleKind, string> = {
  announcement: '発表',
  news: 'ニュース',
  preview: '紹介',
  review: 'レビュー',
  interview: 'インタビュー',
  devlog: '開発日誌',
  feature: '特集',
  roundup: 'まとめ',
  'press-release': 'プレスリリース',
  video: '動画',
  other: 'その他',
};

/** 記事一覧のタブ（02 §2.3.6） */
export const ARTICLE_TABS: ArticleKind[] = [
  'announcement',
  'news',
  'preview',
  'review',
  'interview',
  'devlog',
  'feature',
  'roundup',
];

export const ARTICLE_ROLE_LABELS: Record<ArticleRole, string> = {
  primary: '主題',
  mention: '言及',
  roundup: 'まとめ記事内の紹介',
};

const LANG_LABELS: Record<string, string> = {
  ja: '日本語',
  en: '英語',
  zh: '中国語',
  ko: '韓国語',
  fr: 'フランス語',
  de: 'ドイツ語',
};
export function langLabel(lang: string): string {
  return LANG_LABELS[lang.split('-')[0]!] ?? lang;
}

export const RELATION_LABELS: Record<string, string> = {
  'similar-play': '遊びが近い',
  'same-series': '同じシリーズ',
  'spiritual-successor': '精神的な後継作',
  'shared-theme': '題材が近い',
  'often-compared': 'よく比べられる',
  'same-developer': '同じ開発者',
};

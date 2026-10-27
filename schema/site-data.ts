import type {
  ArticleKind,
  ArticleRole,
  PartialDate,
  Platform,
  PlayerMode,
  Region,
  ReleaseStatus,
  RelationKind,
  Store,
  Support,
  TagGroup,
} from './common.ts';

/** 公開内容ハッシュの計算から除くキー（07 §7.4.1）。どの深さにあっても取り除く */
export const VOLATILE_KEYS = ['checkedAt', 'lastCheckedAt', 'builtAt', 'generatedAt'] as const;

export interface SourceRef {
  label: string; // 媒体名。なければドメイン名
  url: string;
  kind: 'official' | 'store' | 'media' | 'database' | 'event';
  publishedAt?: string; // ISO 8601
  checkedAt: string; // 最後に確認した日時（公開内容ハッシュの計算から除く）
}

export interface SiteReleaseEntry {
  platform: Platform;
  region: Region;
  status: ReleaseStatus;
  date?: PartialDate;
  rawText?: string;
  label: string;
  sources: SourceRef[];
}

export interface SiteGame {
  id: string; // g_000123
  path: string; // /games/g_000123/（ベースパスを含まない）
  title: { display: string; original: string; originalLang: string };
  aliases: string[]; // 索引用。表示は主なものだけ
  developers: { id: string; name: string }[];
  publishers: { id: string; name: string }[];
  addedAt: string; // YYYY-MM-DD（収録日）
  updatedAt: string; // YYYY-MM-DD（ページの最終更新日）
  enrichedAt?: string; // YYYY-MM-DD（04 §4.9）
  enrichedNote?: string; // 例: 「発売日が更新」
  release: {
    overall: { status: ReleaseStatus; label: string; sortKey?: string };
    entries: SiteReleaseEntry[];
    history: { platform: Platform; label: string; asOf: string; sources: SourceRef[] }[];
    conflicted: boolean; // 採用済みの値がないまま矛盾している（「確認中」）
  } | null;
  platforms: Platform[];
  japaneseSupport: null | {
    interface: Support;
    subtitles: Support;
    audio: Support;
    platform?: Platform;
    sources: SourceRef[];
  };
  playerModes: null | { modes: PlayerMode[]; minPlayers?: number; maxPlayers?: number; sources: SourceRef[] };
  summary: null | { text: string; sources: SourceRef[] };
  features: null | { items: string[]; sources: SourceRef[] };
  tags: { id: string; label: string; group: TagGroup }[];
  tagSources: SourceRef[];
  stores: { store: Store; url: string; platform?: Platform; sources: SourceRef[] }[];
  officialUrl?: string;
  image?: { url: string; width?: number; height?: number; alt: string; credit?: string };
  screenshots: { url: string; large: string; width?: number; height?: number; alt: string; credit?: string }[];
  palette?: string[]; // #rrggbb を3色（画像から抽出した主な色）
  theme?: { dark: Record<string, string>; light: Record<string, string> }; // 作品詳細のページの色（CSS 変数）
  primaryGenre?: string; // 主なジャンル系タグの ID
  articles: { id: string; role: ArticleRole }[]; // 詳細は articles.json から引く
  related: { gameId: string; kind: RelationKind | 'same-developer'; reason: string }[];
  collections: string[]; // コレクション ID
  coverage: { articleCount: number; filledFields: number };
}

export interface SiteArticle {
  id: string;
  url: string;
  title: string | null; // displayTitle: false の情報源では null
  lang: string;
  kind: ArticleKind;
  outlet: { name: string; domain: string };
  publishedAt?: string;
  summaryJa?: string;
  image?: { path: string; width: number; height: number }; // public/ からの相対パス
  games: { gameId: string; role: ArticleRole }[];
}

export interface SiteCollection {
  id: string;
  path: string;
  title: string;
  lede: string;
  description: string; // Markdown
  criteria: string;
  featured: boolean;
  updatedAt: string; // YYYY-MM-DD
  items: { gameId: string; reason: string }[]; // order に従って並べ替え済み
}

export interface SiteTag {
  id: string;
  label: string;
  labelEn: string;
  group: TagGroup;
  aliases: string[];
  gameCount: number;
}

export interface SiteEvent {
  id: string;
  name: string;
  nameEn?: string;
  kind: string;
  format: 'in-person' | 'online' | 'hybrid';
  start: PartialDate;
  end?: PartialDate;
  startKey: string; // YYYY-MM-DD（並べ替えと月の見出しに使う）
  endKey: string;
  dateLabel: string; // 例: 2026年11月3日（火）、2027年2月22日（月）〜3月1日（月）
  time?: string;
  location?: { venue: string; city?: string; country?: string };
  url: string;
  summary: string;
  tentative: boolean;
  phase: 'upcoming' | 'ongoing' | 'past'; // ビルドした日（日本時間）での状態。終わると公開内容ハッシュが変わり、公開し直す
  games: string[];
  sources: SourceRef[];
}

/** ジャンルのカテゴリ色に使う、主なジャンルの上位8件（02 §2.6.1） */
export interface SiteGenre {
  id: string;
  label: string;
}

export interface SiteStats {
  games: number;
  articles: number;
  collections: number;
  tags: number;
  lastUpdated: string; // YYYY-MM-DD
}

export interface SiteMeta {
  contentHash: string;
  siteData: string;
  generatedAt: string;
}

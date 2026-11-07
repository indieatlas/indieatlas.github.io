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
  activityAt: string; // ISO 8601。情報か関連記事が最後に増えた日時（作品一覧の並び順に使う）
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
  overview: null | { paragraphs: string[]; sources: SourceRef[] }; // 定番の作品などの詳しい紹介
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
  prominence: Prominence;
  madeInJapan: boolean; // 開発元のいずれかが日本を拠点にしている（出典で確かめたもの）
  steamReviews?: number; // Steam のレビュー数（知名度の目安）
  steamScore?: { percent: number; total: number; label: string; japaneseOnly: boolean }; // Steam の好評の割合と評価の表記
  reviewSummary?: { pros: string[]; cons: string[]; reviewCount: number; generatedAt: string }; // Steam のレビューの要約
  // IGDB の評価（0〜100 の整数に丸める）。件数が少ないものは出さない
  ratings?: { total?: number; totalCount?: number; critic?: number; criticCount?: number; url: string };
}

/** 見せ方の強弱。landmark は誰もが知る定番、notable は話題になった作品 */
export type Prominence = 'landmark' | 'notable' | 'standard';

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
  // 同じ話題の記事のまとまり。一覧ではまとまりの先頭（topicLead）だけを出し、ほかの記事は「同じ話題」として添える
  topicOf?: string; // まとまりの先頭の記事の ID（自分が先頭でなければ）
  sameTopic?: { id: string; outlet: string; url: string; lang: string }[]; // 先頭の記事に添える、同じ話題のほかの記事
  // はてなブックマークでの主な反応を、当サイトが要約したもの（06 §6.13.7）
  reactions?: { points: string[]; bookmarkCount: number; entryUrl: string };
}

/** 開発元とパブリッシャー（/developers/{id}/） */
export interface SiteDeveloper {
  id: string;
  name: string;
  original?: string; // 表示名と違うときの正式な表記
  roles: ('developer' | 'publisher')[];
  officialUrl?: string;
  links: { kind: string; url: string }[];
  independence: 'independent' | 'affiliated' | 'major' | 'unknown';
  developed: string[]; // 開発した収録作品の ID（更新の新しい順）
  published: string[]; // 販売した収録作品の ID
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
  image?: { path: string; width: number; height: number }; // public/ からの相対パス
  tentative: boolean;
  // ビルドした日（日本時間）での状態。終わると公開内容ハッシュが変わり、公開し直す。
  // ongoing は3日以内の催しの期間中、running はそれより長い催しの期間中（「開催中」とは見せない）
  phase: 'upcoming' | 'ongoing' | 'running' | 'past';
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

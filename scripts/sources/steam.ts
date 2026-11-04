import { shortHash } from '../lib/hash.ts';
import type { PartialDate, PlayerMode, ReleaseStatus, Support } from '../../schema/common.ts';
import type { HttpClient } from '../fetch/http.ts';

/** Steam ストアの作品詳細の JSON（store.steampowered.com/api/appdetails）のうち、使う項目 */
export interface SteamAppDetails {
  type: string; // game、demo、dlc、music など
  name: string;
  steam_appid: number;
  short_description?: string;
  about_the_game?: string; // ストアの「このゲームについて」（HTML）
  supported_languages?: string;
  header_image?: string;
  capsule_image?: string;
  website?: string | null;
  developers?: string[];
  publishers?: string[];
  demos?: { appid: number; description?: string }[];
  dlc?: number[];
  fullgame?: { appid: string | number; name: string };
  platforms?: { windows?: boolean; mac?: boolean; linux?: boolean };
  categories?: { id: number; description: string }[];
  genres?: { id: string; description: string }[];
  release_date?: { coming_soon: boolean; date: string };
  content_descriptors?: { ids: number[]; notes: string | null };
  required_age?: number | string;
}

export interface LanguageSupport {
  language: string;
  interface: boolean;
  fullAudio: boolean;
  subtitles: boolean;
}

export const STEAM_EARLY_ACCESS_GENRE = '70';

export function storeUrl(appId: number): string {
  return `https://store.steampowered.com/app/${appId}/`;
}

export function appDetailsUrl(appId: number, lang: 'english' | 'japanese'): string {
  return `https://store.steampowered.com/api/appdetails?appids=${appId}&l=${lang}&cc=jp`;
}

export async function fetchAppDetails(
  http: HttpClient,
  appId: number,
  lang: 'english' | 'japanese',
): Promise<{ data: SteamAppDetails; url: string; retrievedAt: Date; fetchHash: string }> {
  const url = appDetailsUrl(appId, lang);
  const res = await http.get(url);
  if (res.status !== 200) throw new Error(`appdetails ${appId}: HTTP ${res.status}`);
  const json = JSON.parse(res.text) as Record<string, { success: boolean; data?: SteamAppDetails }>;
  const entry = json[String(appId)];
  if (!entry?.success || !entry.data) throw new Error(`appdetails ${appId}: not found`);
  return { data: entry.data, url, retrievedAt: res.retrievedAt, fetchHash: res.fetchHash };
}

/** ストアのページ（年齢確認を通した HTML） */
export async function fetchStorePage(http: HttpClient, appId: number) {
  return http.get(`${storeUrl(appId)}?l=english&cc=jp`, {
    headers: { cookie: 'birthtime=0; lastagecheckage=1-0-1990; wants_mature_content=1' },
  });
}

/** ストアのページの言語の表（Interface、Full Audio、Subtitles）を読む */
export function parseLanguageTable(html: string): LanguageSupport[] {
  const start = html.indexOf('game_language_options');
  if (start < 0) return [];
  const end = html.indexOf('</table>', start);
  const table = html.slice(start, end < 0 ? undefined : end);
  const rows: LanguageSupport[] = [];
  for (const row of table.split(/<tr\b/).slice(1)) {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1] ?? '');
    if (cells.length < 4) continue;
    const name = cells[0]!.replace(/<[^>]+>/g, '').trim();
    const checked = (c: string) => /&#10004;|✔/.test(c);
    rows.push({
      language: name,
      interface: checked(cells[1]!),
      fullAudio: checked(cells[2]!),
      subtitles: checked(cells[3]!),
    });
  }
  return rows;
}

/** 日本語対応の Claim の値。表に日本語がなければ、すべて非対応とする */
export function japaneseSupportFrom(rows: LanguageSupport[]): {
  interface: Support;
  subtitles: Support;
  audio: Support;
} {
  const ja = rows.find((r) => r.language === 'Japanese');
  if (!ja) return { interface: 'no', subtitles: 'no', audio: 'no' };
  const s = (b: boolean): Support => (b ? 'yes' : 'no');
  return { interface: s(ja.interface), subtitles: s(ja.subtitles), audio: s(ja.fullAudio) };
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
const SEASONS: Record<string, 'spring' | 'summer' | 'autumn' | 'winter'> = {
  spring: 'spring',
  summer: 'summer',
  fall: 'autumn',
  autumn: 'autumn',
  winter: 'winter',
};

function month(name: string): number | undefined {
  return MONTHS[name.slice(0, 3).toLowerCase()];
}

/** Steam の英語の発売日の表記を PartialDate にする。読めない表記（Coming soon など）は undefined */
export function parseSteamDate(text: string): PartialDate | undefined {
  const t = text.trim().replace(/\s+/g, ' ');
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(\d{1,2}) ([A-Za-z]{3,9})\.?,? (\d{4})$/))) {
    const mo = month(m[2]!);
    if (mo) return { precision: 'day', year: Number(m[3]), month: mo, day: Number(m[1]) };
  }
  if ((m = t.match(/^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/))) {
    const mo = month(m[1]!);
    if (mo) return { precision: 'day', year: Number(m[3]), month: mo, day: Number(m[2]) };
  }
  if ((m = t.match(/^([A-Za-z]{3,9}) (\d{4})$/))) {
    const season = SEASONS[m[1]!.toLowerCase()];
    if (season) return { precision: 'season', year: Number(m[2]), season };
    const mo = month(m[1]!);
    if (mo) return { precision: 'month', year: Number(m[2]), month: mo };
  }
  if ((m = t.match(/^Q([1-4]) (\d{4})$/i))) return { precision: 'quarter', year: Number(m[2]), quarter: Number(m[1]) };
  if ((m = t.match(/^H([12]) (\d{4})$/i)))
    return { precision: 'half', year: Number(m[2]), half: Number(m[1]) as 1 | 2 };
  if ((m = t.match(/^(\d{4})$/))) return { precision: 'year', year: Number(m[1]) };
  return undefined;
}

/** 発売の Claim の値（Steam 上の状態） */
export function releaseFrom(app: SteamAppDetails): { status: ReleaseStatus; date?: PartialDate; rawText?: string } {
  const raw = app.release_date?.date?.trim() ?? '';
  const date = raw ? parseSteamDate(raw) : undefined;
  const rawText = raw ? raw.slice(0, 60) : undefined;
  if (app.release_date?.coming_soon) {
    return date ? { status: 'upcoming', date, rawText } : { status: 'tba', ...(rawText ? { rawText } : {}) };
  }
  const earlyAccess = (app.genres ?? []).some((g) => String(g.id) === STEAM_EARLY_ACCESS_GENRE);
  if (!date) return { status: 'tba', ...(rawText ? { rawText } : {}) };
  return { status: earlyAccess ? 'early-access' : 'released', date, rawText };
}

const CATEGORY_MODES: Record<number, PlayerMode> = {
  2: 'single',
  38: 'online-coop',
  39: 'local-coop',
  36: 'online-pvp',
  37: 'local-pvp',
  20: 'mmo',
};

/** カテゴリから読めるプレイ形式。読めなければ空 */
export function playerModesFrom(app: SteamAppDetails): PlayerMode[] {
  const modes = new Set<PlayerMode>();
  for (const c of app.categories ?? []) {
    const m = CATEGORY_MODES[c.id];
    if (m) modes.add(m);
  }
  const order = ['single', 'local-coop', 'online-coop', 'local-pvp', 'online-pvp', 'async', 'mmo'];
  return [...modes].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

export function platformsFrom(app: SteamAppDetails): ('pc' | 'mac' | 'linux')[] {
  const p = app.platforms ?? {};
  const out: ('pc' | 'mac' | 'linux')[] = [];
  if (p.windows) out.push('pc');
  if (p.mac) out.push('mac');
  if (p.linux) out.push('linux');
  return out;
}

/**
 * 成人向けの性的な内容に関する記述子（D-09 の既定値）。Steam の記述子の ID は
 * 1: Some Nudity or Sexual Content、3: Adult Only Sexual Content、4: Frequent Nudity or Sexual Content。
 * P2-02 で確認する。
 */
export const ADULT_SEXUAL_DESCRIPTORS = [3, 4];

export function isAdultSexualContent(app: SteamAppDetails): boolean {
  return (app.content_descriptors?.ids ?? []).some((id) => ADULT_SEXUAL_DESCRIPTORS.includes(id));
}

/** ヘッダー画像の URL から、キャッシュ用のクエリを外す */
export function stableImageUrl(url: string): string {
  const u = new URL(url);
  u.search = '';
  return u.href;
}

/** レビューの集計（appreviews の query_summary）。言語はすべて、購入の経路はすべて */
export function appReviewsUrl(appId: number): string {
  return `https://store.steampowered.com/appreviews/${appId}?json=1&language=all&purchase_type=all&num_per_page=0`;
}

export interface SteamReviewScore {
  positive: number;
  total: number;
  desc: string; // 例: Overwhelmingly Positive、非常に好評
  language?: 'japanese'; // 日本語のレビューだけの集計なら japanese。なければすべての言語
}

/** appreviews の応答から集計を読む。形が違えば undefined（転送されたときなど） */
export function parseReviewSummary(text: string): SteamReviewScore | undefined {
  try {
    const body = JSON.parse(text) as {
      success?: number;
      query_summary?: { total_positive?: number; total_reviews?: number; review_score_desc?: string };
    };
    const q = body.query_summary;
    if (body.success !== 1 || !q || !q.total_reviews || q.total_positive === undefined) return undefined;
    return { positive: q.total_positive, total: q.total_reviews, desc: q.review_score_desc ?? '' };
  } catch {
    return undefined;
  }
}

// Steam の評価の表記（英語）を日本語のストアの表記にする
export const REVIEW_SCORE_JA: Record<string, string> = {
  'Overwhelmingly Positive': '圧倒的に好評',
  'Very Positive': '非常に好評',
  Positive: '好評',
  'Mostly Positive': 'やや好評',
  Mixed: '賛否両論',
  'Mostly Negative': 'やや不評',
  Negative: '不評',
  'Very Negative': '非常に不評',
  'Overwhelmingly Negative': '圧倒的に不評',
};

/** 「役に立った」順のレビュー（本文を含む）。言語ごとに取る */
export function appReviewListUrl(appId: number, language: 'japanese' | 'english', count = 50): string {
  return `https://store.steampowered.com/appreviews/${appId}?json=1&filter=all&language=${language}&purchase_type=all&num_per_page=${count}&cursor=*`;
}

export interface SteamReview {
  id: string; // recommendationid
  text: string;
  votedUp: boolean;
  votesUp: number;
  language: string;
}

export function parseReviewList(text: string): SteamReview[] | undefined {
  try {
    const body = JSON.parse(text) as {
      success?: number;
      reviews?: { recommendationid: string; review: string; voted_up: boolean; votes_up: number; language: string }[];
    };
    if (body.success !== 1 || !Array.isArray(body.reviews)) return undefined;
    return body.reviews
      .filter((r) => r.review && r.review.trim().length >= 20)
      .map((r) => ({
        id: r.recommendationid,
        text: r.review
          .replace(/\[[^\]]+\]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 1200),
        votedUp: r.voted_up,
        votesUp: r.votes_up,
        language: r.language,
      }));
  } catch {
    return undefined;
  }
}

/** インディーのタグ（492）が付いたゲーム本編（category1=998）の、日本での売上上位 */
export function indieTopSellersUrl(count = 30): string {
  return `https://store.steampowered.com/search/results/?filter=topsellers&cc=jp&l=japanese&json=1&count=${count}&category1=998&tags=492`;
}

export function parseTopSellers(text: string): { appId: number; title: string; image?: string }[] | undefined {
  try {
    const body = JSON.parse(text) as { items?: { name?: string; logo?: string }[] };
    if (!Array.isArray(body.items)) return undefined;
    const out: { appId: number; title: string; image?: string }[] = [];
    for (const it of body.items) {
      const id = it.logo?.match(/\/apps\/(\d+)\//)?.[1];
      if (!id || !it.name) continue;
      // 一覧の小さな画像（120x45）の URL を、同じ場所にある 231x87 の画像にする
      const image = it.logo!.replace('capsule_sm_120', 'capsule_231x87');
      out.push({ appId: Number(id), title: it.name, ...(image.startsWith('https://') ? { image } : {}) });
    }
    return out;
  } catch {
    return undefined;
  }
}

/** ストアのページ（日本語）の、日本語のレビューの集計。「あなたの言語でのユーザーレビュー2,054件中92%が好評です」 */
export function storeReviewPageUrl(appId: number): string {
  return `https://store.steampowered.com/app/${appId}/?l=japanese&cc=jp`;
}

export function parseStoreReviewScore(html: string): SteamReviewScore | undefined {
  // 日本語のレビューが十分にあれば日本語の集計、なければすべての言語の集計
  const ja = html.match(/あなたの言語でのユーザーレビュー([\d,]+)件中(\d+)%が好評です/);
  const all = html.match(/このゲームのユーザーレビュー([\d,]+)件中(\d+)%が好評です/);
  const m = ja ?? all;
  if (!m) return undefined;
  const total = Number(m[1]!.replace(/,/g, ''));
  const percent = Number(m[2]);
  if (!total) return undefined;
  // その行の近くにある評価の表記（例: 非常に好評）
  const rest = html.slice(html.indexOf(m[0]));
  const desc = rest.match(/game_review_summary[^"]*"[^>]*>([^<]+)</)?.[1]?.trim() ?? '';
  return {
    positive: Math.round((total * percent) / 100),
    total,
    desc,
    ...(ja ? { language: 'japanese' as const } : {}),
  };
}

/** コミュニティのレビューの一覧（「役に立った」順、10件ずつ）。robots.txt で禁じられていない */
export function communityReviewsUrl(appId: number, language: 'japanese' | 'english', page: number): string {
  const q = new URLSearchParams({
    userreviewsoffset: String((page - 1) * 10),
    p: String(page),
    numperpage: '10',
    browsefilter: 'toprated',
    appid: String(appId),
    appHubSubSection: '10',
    l: language,
    filterLanguage: 'default',
    searchText: '',
    maxInappropriateScore: '50',
  });
  return `https://steamcommunity.com/app/${appId}/homecontent/?${q}`;
}

export function parseCommunityReviews(html: string, language: string): SteamReview[] {
  const out: SteamReview[] = [];
  for (const card of html.split('class="apphub_Card ').slice(1)) {
    const id = card.match(/steamcommunity\.com\/(?:profiles|id)\/([\w-]{1,64})\/recommended\//)?.[1];
    const body = card.match(/apphub_CardTextContent">([\s\S]*?)<\/div>\s*<\/div>/)?.[1];
    if (!id || !body) continue;
    const text = decodeEntities(
      body
        .replace(/<div class="date_posted">[\s\S]*?<\/div>/, ' ')
        .replace(/<br\s*\/?>/g, ' ')
        .replace(/<[^>]+>/g, ' '),
    )
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1200);
    if (text.length < 20) continue;
    const votes = Number(
      card
        .match(/([\d,]+)\s*(?:人がこのレビューが参考になったと投票|people found this review helpful)/)?.[1]
        ?.replace(/,/g, '') ?? 0,
    );
    // 投稿者のプロフィールの ID は個人に結びつくので、ハッシュにして持つ
    out.push({ id: shortHash(`steam-user:${id}`), text, votedUp: /thumbsUp/.test(card), votesUp: votes, language });
  }
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

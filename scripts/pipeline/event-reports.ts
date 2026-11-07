import type { EventReport, EventReportPlatform, IndieEvent } from '../../schema/event.ts';
import type { HttpClient } from '../fetch/http.ts';
import { toJstDate } from '../lib/clock.ts';
import { endOf, startOf } from '../lib/partial-date.ts';
import { normalizeUrl } from '../lib/url-normalize.ts';

// 会場の催しの感想（個人のブログ、note）を集める（06 §6.13.8）。
// 催しの名前のハッシュタグ（note）と、はてなブックマークの検索から、見出しに催しの名前がある記事だけを拾う。
// 本文は保存せず、見出し、書き手、掲載日、URL だけを残す

/** 催しが終わってから感想を探す日数 */
export const REPORT_WINDOW_DAYS = 30;
/** 回の番号のない呼び名（「ゲムダン」だけ）で拾うのは、終わってからこの日数まで */
export const SERIES_WINDOW_DAYS = 14;
/** 1つの催しに載せる感想の上限 */
export const MAX_REPORTS_PER_EVENT = 60;

/** 照合用の正規化。全角を半角に、大文字を小文字にし、文字と数字以外を除く */
export function squash(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** 名前の末尾の回の番号や年を外す（「東京ゲームダンジョン14」→「東京ゲームダンジョン」、番号「14」） */
export function splitEdition(name: string): { series: string; edition?: string } {
  const m = /^(.*?\D)(\d+)$/.exec(name);
  return m ? { series: m[1]!, edition: m[2]! } : { series: name };
}

/** 催しのこの回の名前（正規化済み）。正式な名前、英語の名前、別名 */
export function editionTerms(e: Pick<IndieEvent, 'name' | 'nameEn' | 'aliases'>): string[] {
  return [...new Set([e.name, e.nameEn, ...(e.aliases ?? [])].filter((x): x is string => !!x).map(squash))].filter(
    (t) => t.length >= 3,
  );
}

/** 回の番号を外した呼び名（正規化済み）。番号のない名前は含めない */
function seriesTerms(e: Pick<IndieEvent, 'name' | 'nameEn' | 'aliases'>): { series: string; edition: string }[] {
  const out: { series: string; edition: string }[] = [];
  for (const t of editionTerms(e)) {
    const { series, edition } = splitEdition(t);
    if (edition && [...series].length >= 4) out.push({ series, edition });
  }
  return out;
}

/** note で探すハッシュタグ。この回の名前と、回の番号を外した名前（空白を除いた原文の表記） */
export function noteHashtags(e: Pick<IndieEvent, 'name' | 'aliases'>): string[] {
  const tags = new Set<string>();
  for (const n of [e.name, ...(e.aliases ?? [])]) {
    const tag = n.normalize('NFKC').replace(/[\s#]+/g, '');
    if ([...tag].length < 3) continue;
    tags.add(tag);
    const { series, edition } = splitEdition(tag);
    if (edition && [...series].length >= 4) tags.add(series);
  }
  return [...tags].slice(0, 4);
}

/** 見出しがこの回を指しているか。'edition' はこの回の名前、'series' は番号のない呼び名だけ */
export function mentionsEvent(
  e: Pick<IndieEvent, 'name' | 'nameEn' | 'aliases'>,
  title: string,
): 'edition' | 'series' | undefined {
  const t = squash(title);
  if (editionTerms(e).some((x) => t.includes(x))) return 'edition';
  for (const { series } of seriesTerms(e)) {
    let i = t.indexOf(series);
    let bare = false;
    while (i >= 0) {
      // ほかの回（「ゲムダン15」）を指す見出しは除く
      if (!/^\d/.test(t.slice(i + series.length))) bare = true;
      else return undefined;
      i = t.indexOf(series, i + 1);
    }
    if (bare) return 'series';
  }
  return undefined;
}

const GAME_WORDS = /ゲーム|ゲー|game|インディー|indie|試遊|出展/i;

export interface ReportCandidate {
  url: string;
  title: string;
  author?: string;
  publishedAt?: string; // UTC の ISO 8601
  description?: string;
  platform: EventReportPlatform;
  foundVia: EventReport['foundVia'];
}

const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** 感想を集める催し。会場の催しで、日付まで決まっていて、始まってから終わりの30日後まで */
export function reportTargets(events: IndieEvent[], today: string): IndieEvent[] {
  return events.filter(
    (e) =>
      e.format !== 'online' &&
      e.status === 'scheduled' &&
      e.start.precision === 'day' &&
      startOf(e.start) <= today &&
      addDays(endOf(e.end ?? e.start), REPORT_WINDOW_DAYS) >= today,
  );
}

/**
 * 候補がこの回の感想か。見出しにこの回の名前があり、催しが始まってから30日以内に書かれたもの。
 * 番号のない呼び名だけなら14日以内。ゲームの話でないもの（同じ名前のほかの催しなど）は除く
 */
export function isReportOf(e: IndieEvent, c: Pick<ReportCandidate, 'title' | 'description'>, at: string): boolean {
  const day = toJstDate(new Date(at));
  const start = startOf(e.start);
  const end = endOf(e.end ?? e.start);
  if (day < start) return false;
  const how = mentionsEvent(e, c.title);
  if (!how) return false;
  if (day > addDays(end, how === 'edition' ? REPORT_WINDOW_DAYS : SERIES_WINDOW_DAYS)) return false;
  return GAME_WORDS.test(`${e.name} ${c.title} ${c.description ?? ''}`);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(\w+);/g, (m, name: string) => ENTITIES[name] ?? m)
    .trim();
}
function tag(xml: string, name: string): string | undefined {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? decode(m[1]!) : undefined;
}
function iso(text: string | undefined): string | undefined {
  const t = text ? Date.parse(text) : NaN;
  return Number.isNaN(t) ? undefined : new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
}
const plain = (html: string | undefined) =>
  html
    ? decode(html.replace(/<[^>]+>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 300)
    : undefined;

/** note の URL から問い合わせを外す（記事の URL は https://note.com/{書き手}/n/{記事}） */
function noteUrl(url: string): string | undefined {
  const u = new URL(url);
  if (u.hostname !== 'note.com' || !/^\/[^/]+\/n\/n[0-9a-z]+$/.test(u.pathname)) return undefined;
  return `https://note.com${u.pathname}`;
}

/** note のハッシュタグの RSS（https://note.com/hashtag/{タグ}/rss）を読む */
export function parseNoteHashtagFeed(xml: string): ReportCandidate[] {
  const out: ReportCandidate[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const body = m[1]!;
    const title = tag(body, 'title');
    const link = tag(body, 'link');
    const url = link && /^https:\/\//.test(link) ? noteUrl(link) : undefined;
    if (!title || !url) continue;
    const author = tag(body, 'note:creatorName');
    const publishedAt = iso(tag(body, 'pubDate'));
    const description = plain(tag(body, 'description'));
    out.push({
      url,
      title: title.slice(0, 300),
      ...(author ? { author: author.slice(0, 80) } : {}),
      ...(publishedAt ? { publishedAt } : {}),
      ...(description ? { description } : {}),
      platform: 'note',
      foundVia: 'note-hashtag',
    });
  }
  return out;
}

export function noteHashtagFeedUrl(tag: string): string {
  return `https://note.com/hashtag/${encodeURIComponent(tag)}/rss`;
}

/** はてなブックマークの検索の RSS。ブックマークが1件以上ある、最近1か月の記事 */
export function hatenaSearchUrl(query: string): string {
  return `https://b.hatena.ne.jp/q/${encodeURIComponent(query)}?mode=rss&target=all&sort=recent&users=1&date_range=1m`;
}

// 個人が書くブログのサービス。これ以外のドメイン（媒体、まとめ、転載）は拾わない
const BLOG_HOSTS: { re: RegExp; platform: EventReportPlatform }[] = [
  { re: /\.(hatenablog\.(com|jp)|hateblo\.jp|hatenadiary\.(com|jp|org))$/, platform: 'hatena-blog' },
  {
    re: /(^|\.)(ameblo\.jp|livedoor\.blog|blog\.jp|fc2\.com|seesaa\.net|zenn\.dev|qiita\.com|medium\.com|blogspot\.com|jugem\.jp|exblog\.jp)$/,
    platform: 'blog',
  },
];

export function blogPlatform(url: string): EventReportPlatform | undefined {
  const host = new URL(url).hostname;
  if (host === 'note.com') return 'note';
  return BLOG_HOSTS.find((b) => b.re.test(host))?.platform;
}

/** はてなブックマークの検索の RSS から、個人のブログの記事だけを読む。日時はブックマークされた日時 */
export function parseHatenaSearchFeed(xml: string): (ReportCandidate & { bookmarkedAt?: string })[] {
  const out: (ReportCandidate & { bookmarkedAt?: string })[] = [];
  for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g)) {
    const body = m[0];
    const title = tag(body, 'title');
    const link = tag(body, 'link');
    if (!title || !link || !/^https?:\/\//.test(link)) continue;
    const platform = blogPlatform(link);
    if (!platform) continue;
    const url = platform === 'note' ? noteUrl(link) : normalizeUrl(link);
    if (!url) continue;
    const bookmarkedAt = iso(tag(body, 'dc:date'));
    const description = plain(tag(body, 'description'));
    out.push({
      url,
      title: title.slice(0, 300),
      ...(description ? { description } : {}),
      ...(bookmarkedAt ? { bookmarkedAt } : {}),
      platform,
      foundVia: 'hatena-bookmark',
    });
  }
  return out;
}

/** ブログの記事のページから、掲載日時と書き手（ブログの名前）を読む */
export function parseBlogPage(html: string): { publishedAt?: string; author?: string; title?: string } {
  const meta = (prop: string) =>
    new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`, 'i').exec(html)?.[1] ??
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, 'i').exec(html)?.[1];
  const published =
    meta('article:published_time') ??
    /"datePublished"\s*:\s*"([^"]+)"/.exec(html)?.[1] ??
    /<time[^>]+datetime=["']([^"']+)["'][^>]*itemprop=["']datePublished/i.exec(html)?.[1] ??
    /<time[^>]+datetime=["'](\d{4}-\d{2}-\d{2}T[^"']+)["']/i.exec(html)?.[1];
  const publishedAt = iso(published);
  const site = meta('og:site_name');
  const title = meta('og:title');
  return {
    ...(publishedAt ? { publishedAt } : {}),
    ...(site ? { author: decode(site).slice(0, 80) } : {}),
    ...(title ? { title: decode(title).slice(0, 300) } : {}),
  };
}

export interface CollectResult {
  added: { eventId: string; report: EventReport }[];
  errors: string[];
}

/**
 * 催しごとに候補を集め、感想と判定したものを返す。known は登録済みの URL（hidden を含む。拾い直さない）
 */
export async function collectEventReports(
  http: HttpClient,
  events: IndieEvent[],
  known: Map<string, Set<string>>, // eventId → URL
  at: string,
): Promise<CollectResult> {
  const result: CollectResult = { added: [], errors: [] };
  const get = async (url: string): Promise<string | undefined> => {
    try {
      const r = await http.get(url);
      // 使われていないハッシュタグは 404 になる
      if (r.status === 404) return undefined;
      if (r.status !== 200) {
        result.errors.push(`${r.status} ${url}`);
        return undefined;
      }
      return r.text;
    } catch (err) {
      result.errors.push(`${(err as Error).message} ${url}`);
      return undefined;
    }
  };
  for (const e of events) {
    const seen = new Set(known.get(e.id) ?? []);
    const room = () => MAX_REPORTS_PER_EVENT - seen.size;
    const accept = (c: ReportCandidate, when: string) => {
      if (seen.has(c.url) || room() <= 0 || !isReportOf(e, c, when)) return;
      seen.add(c.url);
      result.added.push({
        eventId: e.id,
        report: {
          url: c.url,
          title: c.title,
          ...(c.author ? { author: c.author } : {}),
          platform: c.platform,
          ...(c.publishedAt ? { publishedAt: c.publishedAt } : {}),
          foundVia: c.foundVia,
          foundAt: at,
          status: 'shown',
        },
      });
    };
    for (const t of noteHashtags(e)) {
      const xml = await get(noteHashtagFeedUrl(t));
      if (!xml) continue;
      for (const c of parseNoteHashtagFeed(xml)) if (c.publishedAt) accept(c, c.publishedAt);
    }
    const xml = await get(hatenaSearchUrl(e.name));
    for (const c of xml ? parseHatenaSearchFeed(xml) : []) {
      if (seen.has(c.url) || !c.bookmarkedAt || !isReportOf(e, c, c.bookmarkedAt)) continue;
      // note はハッシュタグの RSS で拾える。ほかのブログは、ページから掲載日と書き手を読む
      let found: ReportCandidate = c;
      if (c.platform !== 'note') {
        const html = await get(c.url);
        if (!html) continue;
        const page = parseBlogPage(html);
        found = {
          ...c,
          ...(page.title ? { title: page.title } : {}),
          ...(page.publishedAt ? { publishedAt: page.publishedAt } : {}),
          ...(page.author ? { author: page.author } : {}),
        };
      }
      accept(found, found.publishedAt ?? c.bookmarkedAt);
    }
  }
  return result;
}

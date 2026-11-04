import type { Evidence } from '../../../schema/claim.ts';
import type { SourceConfig } from '../../../schema/config.ts';
import type { EvidenceDraft } from '../../../schema/proposal.ts';
import type { FetchLogEntry } from '../../../schema/research-output.ts';
import { evidenceKindForUrl, originKeyFor, registrableDomain } from '../../lib/domains.ts';
import { sha256Tagged } from '../../lib/hash.ts';
import { normalizeTitle } from '../../lib/text-normalize.ts';
import { normalizeUrl } from '../../lib/url-normalize.ts';

/** 根拠の検証（06 §6.7.2）と、EvidenceDraft から保存する Evidence への変換 */

export interface Violation {
  rule: string;
  message: string;
}

export interface FetchLogIndex {
  get(url: string): FetchLogEntry | undefined;
  entries: FetchLogEntry[];
}

function key(url: string): string | undefined {
  try {
    return normalizeUrl(url);
  } catch {
    return undefined;
  }
}

/** 取得ログを URL（要求、最終、canonical）で引けるようにする。2xx のものを優先する */
export function indexFetchLog(entries: FetchLogEntry[]): FetchLogIndex {
  const map = new Map<string, FetchLogEntry>();
  const ok = (e: FetchLogEntry) => e.status >= 200 && e.status < 300 && !e.blocked;
  for (const e of entries) {
    for (const u of [e.url, e.finalUrl, e.canonicalUrl]) {
      const k = u && key(u);
      if (!k) continue;
      const prev = map.get(k);
      if (!prev || (!ok(prev) && ok(e)) || (ok(prev) === ok(e) && e.retrievedAt > prev.retrievedAt)) map.set(k, e);
    }
  }
  return { get: (url) => (key(url) ? map.get(key(url)!) : undefined), entries };
}

/** 抜粋の照合に使う正規化（NFKC、空白をまとめる、引用符の揺れを揃える） */
export function normalizeForQuote(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[“”„‟"]/g, '"')
    .replace(/[‘’‚‛']/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function quoteInText(quote: string, entry: FetchLogEntry): boolean {
  const q = normalizeForQuote(quote);
  return normalizeForQuote(entry.text).includes(q) || normalizeForQuote(entry.title ?? '').includes(q);
}

/** 根拠が対象を扱っているかの照合に使う、作品の名前と強いキー（V-E03） */
export interface Subject {
  names: string[];
  steamAppIds: number[];
  urls: string[]; // 公式サイト、ストアのページなど（そのページ自体が作品のものなら扱っているとみなす）
}

export function pageMentions(entry: FetchLogEntry, subject: Subject): boolean {
  if (entry.steam) {
    const appId = Number(entry.steam.appId);
    const full = Number(entry.steam.fullgameAppId);
    return subject.steamAppIds.includes(appId) || (full > 0 && subject.steamAppIds.includes(full));
  }
  const final = key(entry.finalUrl);
  if (subject.urls.some((u) => key(u) === final)) return true;
  const hay = normalizeTitle(`${entry.title ?? ''} ${entry.text}`);
  if (subject.names.some((n) => normalizeTitle(n).length >= 2 && hay.includes(normalizeTitle(n)))) return true;
  return subject.steamAppIds.some((id) => entry.text.includes(`/app/${id}`));
}

export interface EvidenceContext {
  log: FetchLogIndex;
  sources: SourceConfig[];
  officialUrls: string[]; // 作品と開発者の公式サイト
  maxQuoteChars: number;
  storeQuotesDefault: boolean;
  /** 記事として登録済み（またはこの結果で登録する）URL の記事 ID と derivedFrom のキー */
  articleFor?(url: string): { id: string; derivedFromKey?: string } | undefined;
}

function sourceFor(url: string, sources: SourceConfig[]): SourceConfig | undefined {
  const d = registrableDomain(url);
  return sources.find(
    (s) => registrableDomain(s.homepage) === d || (s.fetch.url && registrableDomain(s.fetch.url) === d),
  );
}

/** V-E01、V-E02（抜粋）、V-E03、V-E04 */
export function checkEvidence(
  d: EvidenceDraft,
  subject: Subject | undefined,
  ctx: EvidenceContext,
): Violation | undefined {
  const entry = ctx.log.get(d.url);
  if (!entry || entry.status < 200 || entry.status >= 300) {
    return { rule: 'V-E01', message: `evidence ${d.url} is not in the fetch log with 2xx` };
  }
  const src = sourceFor(d.url, ctx.sources);
  if (src && !src.rights.allowFetch)
    return { rule: 'V-E04', message: `${d.url} belongs to a source that forbids fetching` };
  if (entry.noai || entry.blocked)
    return { rule: 'V-E04', message: `${d.url} is not usable (${entry.blocked ?? 'noai'})` };
  if (d.quote && !quoteInText(d.quote, entry))
    return { rule: 'V-E02', message: `quote not found in ${d.url}: ${d.quote.slice(0, 60)}` };
  if (d.locator && !d.quote) {
    if (!entry.steam || !d.locator.startsWith('steam:'))
      return { rule: 'V-E02', message: `locator ${d.locator} has no matching log` };
  }
  if (d.quote && d.quote.length > ctx.maxQuoteChars) return { rule: 'V-E07', message: 'quote too long' };
  if (subject && !pageMentions(entry, subject)) {
    return { rule: 'V-E03', message: `${d.url} does not mention ${subject.names[0] ?? 'the game'}` };
  }
  return undefined;
}

/** 検証を通った EvidenceDraft を保存する形にする。種類、originKey、取得日時は取得ログからコードが補う */
export function toEvidence(d: EvidenceDraft, ctx: EvidenceContext): Evidence {
  const entry = ctx.log.get(d.url)!;
  const src = sourceFor(d.url, ctx.sources);
  const kind = entry.steam
    ? 'store'
    : evidenceKindForUrl(d.url, {
        officialUrls: ctx.officialUrls,
        sources: ctx.sources.map((s) => ({ homepage: s.homepage, evidenceKind: s.evidenceKind })),
      });
  const article = kind === 'media' ? ctx.articleFor?.(d.url) : undefined;
  const storeQuotes = src ? src.rights.storeQuotes : ctx.storeQuotesDefault;
  return {
    kind,
    url: entry.steam ? d.url : (entry.canonicalUrl ?? entry.finalUrl ?? d.url),
    ...(src ? { sourceId: src.id } : {}),
    ...(article ? { articleId: article.id } : {}),
    ...(d.publishedAt ? { publishedAt: d.publishedAt } : entry.publishedAt ? { publishedAt: entry.publishedAt } : {}),
    retrievedAt: entry.retrievedAt,
    ...(d.quote ? (storeQuotes ? { quote: d.quote } : { quoteHash: sha256Tagged(normalizeForQuote(d.quote)) }) : {}),
    ...(d.locator ? { locator: d.locator } : {}),
    originKey: originKeyFor(kind, d.url, article?.derivedFromKey),
    ...(entry.fetchHash ? { fetchHash: entry.fetchHash } : {}),
  };
}

/** V-E05: 根拠の種類と basis の対応 */
export function basisOk(basis: 'fact' | 'reported' | 'editorial', evidence: Evidence[]): boolean {
  if (basis === 'fact') return evidence.some((e) => e.kind === 'official' || e.kind === 'store');
  if (basis === 'reported') return evidence.some((e) => e.kind === 'media' || e.kind === 'event');
  return evidence.length > 0;
}

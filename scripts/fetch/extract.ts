import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

/** HTML から取り出した、調査に使う情報（05 §5.4.3、06 §6.5.3 の fetch_url の出力） */
export interface ExtractedPage {
  title?: string;
  canonicalUrl?: string;
  publishedAt?: string; // UTC の ISO 8601
  lang?: string;
  ogImage?: string;
  text: string; // 本文（Readability で抽出し、空白をまとめたもの）
  links: { url: string; text: string }[]; // 本文の中のリンク（公式サイト、ストア、プレスキットをたどるのに使う）
  noai: boolean; // <meta name="robots" content="noai"> か TDMRep の予約
}

const MAX_LINKS = 60;

function abs(href: string | null | undefined, base: string): string | undefined {
  if (!href) return undefined;
  try {
    const u = new URL(href, base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

function iso(text: string | null | undefined): string | undefined {
  if (!text) return undefined;
  const t = Date.parse(text);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** 空白をまとめる。段落の区切りは改行1つで残す */
export function squashText(s: string): string {
  return s
    .replace(/\r/g, '')
    .split(/\n+/)
    .map((l) => l.replace(/[ \t 　]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function jsonLdPublished(doc: Document): string | undefined {
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(s.textContent ?? '');
      for (const node of [data, ...(Array.isArray(data) ? data : []), ...(data?.['@graph'] ?? [])]) {
        const v = node?.datePublished;
        if (typeof v === 'string' && iso(v)) return iso(v);
      }
    } catch {
      // 壊れた JSON-LD は無視する
    }
  }
  return undefined;
}

export function extractHtml(html: string, pageUrl: string): ExtractedPage {
  const { document } = parseHTML(html);
  const meta = (sel: string) => document.querySelector(sel)?.getAttribute('content') ?? undefined;
  const robots = [...document.querySelectorAll('meta[name="robots" i], meta[name="googlebot" i]')]
    .map((m) => m.getAttribute('content') ?? '')
    .join(',');
  const noai = /\bnoai\b/i.test(robots) || meta('meta[name="tdm-reservation" i]')?.trim() === '1';
  const title = meta('meta[property="og:title"]') ?? document.querySelector('title')?.textContent?.trim() ?? undefined;
  const canonicalUrl = abs(document.querySelector('link[rel="canonical" i]')?.getAttribute('href'), pageUrl);
  const publishedAt =
    iso(meta('meta[property="article:published_time"]')) ??
    iso(meta('meta[name="pubdate" i]')) ??
    iso(document.querySelector('time[datetime]')?.getAttribute('datetime')) ??
    jsonLdPublished(document as unknown as Document);
  const lang = document.documentElement?.getAttribute('lang')?.trim() || undefined;
  const ogImage = abs(meta('meta[property="og:image"]'), pageUrl);

  // Readability は DOM を書き換えるので、リンクは先に集める
  const scope = document.querySelector('article') ?? document.querySelector('main') ?? document.querySelector('body');
  const links: ExtractedPage['links'] = [];
  const seen = new Set<string>();
  for (const a of scope?.querySelectorAll('a[href]') ?? []) {
    const url = abs(a.getAttribute('href'), pageUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    links.push({ url, text: squashText(a.textContent ?? '').slice(0, 80) });
    if (links.length >= MAX_LINKS) break;
  }

  let text = '';
  try {
    const article = new Readability(document as unknown as Document, { charThreshold: 200 }).parse();
    text = article?.textContent ?? '';
  } catch {
    text = '';
  }
  if (squashText(text).length < 200) {
    const { document: fresh } = parseHTML(html);
    for (const el of fresh.querySelectorAll('script, style, noscript, template, svg')) el.remove();
    text = fresh.querySelector('body')?.textContent ?? '';
  }
  return {
    ...(title ? { title: squashText(title) } : {}),
    ...(canonicalUrl ? { canonicalUrl } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    ...(lang ? { lang } : {}),
    ...(ogImage ? { ogImage } : {}),
    text: squashText(text),
    links,
    noai,
  };
}

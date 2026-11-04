import type { RepoData } from '../lib/repo-io.ts';
import { normalizeTitle } from '../lib/text-normalize.ts';
import { lookupUrls } from './refresh-status.ts';

// 情報源のフィード（RSS 1.0、RSS 2.0、Atom）から、新しい記事の候補を作る（12 §12.6.7）。
// 候補を絞るだけで、記事かどうか、どの作品を扱うかはエージェントが本文を読んで決める

export interface FeedItem {
  title: string;
  url: string;
  publishedAt?: string; // UTC の ISO 8601
  categories: string[];
  guid?: string;
  description?: string; // フィードの説明（タグを除き、300字まで）
}

export interface FeedCandidate extends FeedItem {
  sourceId: string;
  gameIds: string[]; // タイトルに名前が含まれる収録作品（公開中と候補）
  articleId?: string; // 登録済みの記事
  seen?: string; // state/seen-urls.json での扱い
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—' };

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

function isoOf(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const t = Date.parse(text);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** フィードの項目を読む。読めない項目は飛ばす */
export function parseFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  for (const m of xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g)) {
    const body = m[2]!;
    const title = tag(body, 'title');
    const url = tag(body, 'link') || /<link[^>]*?href="([^"]+)"/.exec(body)?.[1];
    if (!title || !url || !/^https?:\/\//.test(url)) continue;
    const publishedAt = isoOf(
      tag(body, 'pubDate') ?? tag(body, 'dc:date') ?? tag(body, 'published') ?? tag(body, 'updated'),
    );
    const categories = [
      ...[...body.matchAll(/<(?:category|dc:subject)(?:\s[^>]*)?>([\s\S]*?)<\/(?:category|dc:subject)>/g)].map((c) =>
        decode(c[1]!),
      ),
      ...[...body.matchAll(/<category[^>]*?term="([^"]+)"/g)].map((c) => decode(c[1]!)),
    ];
    const guid = tag(body, 'guid') ?? tag(body, 'id');
    const rawDesc = tag(body, 'description') ?? tag(body, 'summary') ?? tag(body, 'content:encoded');
    const description = rawDesc
      ? decode(rawDesc.replace(/<[^>]+>/g, ' '))
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 300)
      : undefined;
    items.push({
      title,
      url: decode(url),
      ...(publishedAt ? { publishedAt } : {}),
      categories,
      ...(guid ? { guid: guid.slice(0, 300) } : {}),
      ...(description ? { description } : {}),
    });
  }
  return items;
}

/** 英字の名前は語の区切りで、それ以外は正規化した文字列の一部で照合する（「R.E.P.O.」が "reportedly" に当たらないように） */
function words(s: string): string {
  return ` ${s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `;
}

export function matchGames(repo: RepoData, title: string): string[] {
  const t = normalizeTitle(title);
  const w = words(title);
  const hits = new Set<string>();
  for (const g of repo.games.filter((x) => x.status === 'published' || x.status === 'candidate')) {
    for (const name of [g.title.display, g.title.original, ...g.aliases.map((a) => a.value)]) {
      const ascii = /^[\x20-\x7e]+$/.test(name);
      const hit = ascii
        ? w.includes(words(name))
        : normalizeTitle(name).length >= 3 && t.includes(normalizeTitle(name));
      if (hit) hits.add(g.id);
    }
  }
  return [...hits].sort();
}

/** since より新しい項目に、照合した作品と登録済みかを添える */
export function feedCandidates(repo: RepoData, sourceId: string, items: FeedItem[], since?: string): FeedCandidate[] {
  const fresh = items.filter((i) => !since || !i.publishedAt || i.publishedAt > since);
  const known = lookupUrls(
    repo,
    fresh.map((i) => i.url),
  );
  return fresh.map((i, n) => ({
    ...i,
    sourceId,
    gameIds: matchGames(repo, i.title),
    ...(known[n]!.articleId ? { articleId: known[n]!.articleId } : {}),
    ...(known[n]!.seen ? { seen: known[n]!.seen } : {}),
  }));
}

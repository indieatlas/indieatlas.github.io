import type { SourceConfig } from '../../schema/config.ts';
import type { CollectedItem, SourceUpdates } from '../../schema/research-output.ts';
import type { SourceState } from '../../schema/state.ts';
import type { Fetcher } from '../fetch/fetcher.ts';
import { toIsoDateTime } from '../lib/clock.ts';
import { urlKey } from '../lib/ids.ts';
import type { RepoData } from '../lib/repo-io.ts';
import { parseFeed, type FeedItem } from './feed-items.ts';
import { lookupUrls } from './refresh-status.ts';

/**
 * collect（06 §6.3、R2）。LLM を使わずに、情報源のフィードから新着の記事を集める。
 * 処理位置（recentItemKeys）は、取った項目だけ進める。上限で取らなかった項目は次回に回す
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** これより古い項目は取らない（初回の実行で古い記事をまとめて扱わないため） */
export const MAX_ITEM_AGE_DAYS = 14;

export interface CollectResult {
  items: CollectedItem[];
  updates: SourceUpdates['updates'];
}

export function collectTargets(repo: RepoData): SourceConfig[] {
  return repo.sources.sources.filter(
    (s) =>
      s.enabled &&
      s.rights.allowFetch &&
      (s.role === 'discover' || s.role === 'understand') &&
      (s.fetch.method === 'rss' || s.fetch.method === 'atom') &&
      s.fetch.url,
  );
}

function initialState(sourceId: string): SourceState {
  return { schemaVersion: 1, sourceId, cursor: { recentItemKeys: [] }, consecutiveFailures: 0 };
}

/** 取得の時期が来ているか（every-run は毎回、daily は20時間、weekly は6日12時間） */
export function isDue(s: SourceConfig, state: SourceState | undefined, nowMs: number): boolean {
  if (state?.nextAttemptAfter && Date.parse(state.nextAttemptAfter) > nowMs) return false;
  if (!state?.lastSuccessAt) return true;
  const since = nowMs - Date.parse(state.lastSuccessAt);
  if (s.fetch.frequency === 'daily') return since >= 20 * HOUR;
  if (s.fetch.frequency === 'weekly') return since >= 6.5 * DAY;
  return true;
}

function passesFilters(item: FeedItem, s: SourceConfig): boolean {
  const f = s.filters;
  if (!f) return true;
  const text = `${item.title} ${item.description ?? ''}`.toLowerCase();
  if (f.includeKeywords?.length && !f.includeKeywords.some((k) => text.includes(k.toLowerCase()))) return false;
  if (f.excludeKeywords?.some((k) => text.includes(k.toLowerCase()))) return false;
  if (f.includeCategories?.length && !item.categories.some((c) => f.includeCategories!.includes(c))) return false;
  if (f.excludeCategories?.some((c) => item.categories.includes(c))) return false;
  return true;
}

export function itemKeyOf(item: FeedItem): string {
  return (item.guid ?? urlKey(item.url)).slice(0, 300);
}

export async function collect(
  repo: RepoData,
  fetcher: Fetcher,
  states: Map<string, SourceState>,
  nowDate: Date,
): Promise<CollectResult> {
  const nowMs = nowDate.getTime();
  const at = toIsoDateTime(nowDate);
  const items: CollectedItem[] = [];
  const updates: CollectResult['updates'] = [];
  const minDate = new Date(nowMs - MAX_ITEM_AGE_DAYS * DAY).toISOString();
  for (const s of collectTargets(repo)) {
    const prev = states.get(s.id) ?? initialState(s.id);
    if (!isDue(s, prev, nowMs)) continue;
    const headers: Record<string, string> = {};
    if (prev.cursor.etag) headers['if-none-match'] = prev.cursor.etag;
    if (prev.cursor.lastModified) headers['if-modified-since'] = prev.cursor.lastModified;
    const page = await fetcher.fetch(s.fetch.url!, { headers });
    const failed = page.status === 0 || page.status >= 400 || (!!page.blocked && page.status !== 304);
    if (failed) {
      const n = prev.consecutiveFailures + 1;
      const backoffDays = n >= 2 ? Math.min(2 ** (n - 2), 7) : 0;
      updates.push({
        sourceId: s.id,
        ok: false,
        state: {
          ...prev,
          lastAttemptAt: at,
          consecutiveFailures: n,
          lastError: { at, message: (page.error ?? page.blocked ?? `HTTP ${page.status}`).slice(0, 500) },
          ...(backoffDays ? { nextAttemptAfter: toIsoDateTime(new Date(nowMs + backoffDays * DAY)) } : {}),
        },
        itemsFetched: 0,
        itemsTaken: 0,
        error: (page.error ?? page.blocked ?? `HTTP ${page.status}`).slice(0, 500),
      });
      continue;
    }
    const success = (cursor: SourceState['cursor'], fetched: number, taken: number) => {
      const { lastError: _e, nextAttemptAfter: _n, ...rest } = prev;
      updates.push({
        sourceId: s.id,
        ok: true,
        state: { ...rest, cursor, lastAttemptAt: at, lastSuccessAt: at, consecutiveFailures: 0 },
        itemsFetched: fetched,
        itemsTaken: taken,
      });
    };
    if (page.status === 304) {
      success(prev.cursor, 0, 0);
      continue;
    }
    const feed = parseFeed(page.raw ?? '');
    const recent = new Set(prev.cursor.recentItemKeys);
    const known = lookupUrls(
      repo,
      feed.map((i) => i.url),
    );
    const fresh = feed
      .map((item, i) => ({ item, known: known[i]! }))
      .filter(({ item, known }) => {
        if (recent.has(itemKeyOf(item))) return false;
        if (known.articleId) return false;
        if (known.seen === 'article' || known.seen === 'task' || known.seen === 'irrelevant') return false;
        if (item.publishedAt && item.publishedAt < minDate) return false;
        return passesFilters(item, s);
      })
      .sort((a, b) => (a.item.publishedAt ?? '').localeCompare(b.item.publishedAt ?? ''));
    const taken = fresh.slice(0, s.fetch.maxItemsPerRun);
    for (const { item } of taken) {
      items.push({
        itemKey: itemKeyOf(item),
        sourceId: s.id,
        url: item.url,
        title: item.title.slice(0, 400),
        ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
        ...(item.description ? { description: item.description.slice(0, 400) } : {}),
        categories: item.categories.slice(0, 20).map((c) => c.slice(0, 80)),
      });
    }
    // 取った項目と、取らなかったが既に扱った項目だけを処理位置に入れる
    const keys = [...prev.cursor.recentItemKeys, ...taken.map((t) => itemKeyOf(t.item))];
    const latest = taken
      .map((t) => t.item.publishedAt)
      .filter((x): x is string => !!x)
      .sort()
      .pop();
    success(
      {
        recentItemKeys: [...new Set(keys)].slice(-500),
        ...((latest ?? prev.cursor.lastItemPublishedAt)
          ? { lastItemPublishedAt: latest ?? prev.cursor.lastItemPublishedAt }
          : {}),
        ...(page.etag ? { etag: page.etag } : {}),
        ...(page.lastModified ? { lastModified: page.lastModified } : {}),
      },
      feed.length,
      taken.length,
    );
  }
  return { items, updates };
}

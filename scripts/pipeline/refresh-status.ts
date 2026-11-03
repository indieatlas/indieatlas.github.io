import type { PartialDate } from '../../schema/common.ts';
import { adoptedOf } from '../lib/claims-view.ts';
import { urlKey } from '../lib/ids.ts';
import { endOf, startOf } from '../lib/partial-date.ts';
import type { RepoData } from '../lib/repo-io.ts';

// サイトの内容をまとめて最新にする手順（ia-refresh のスキル、12 §12.6.7）のために、
// 古くなったもの、確かめ直すものを data/ から数える。外部とは通信せず、データを変えない

const DAY = 86_400_000;
const EVENT_SOON_DAYS = 30; // 開始の30日前から確かめ直す（06 §6.13.1）
const EVENT_ENDED_DAYS = 365; // 終わってから1年までは、次の回の告知を探す
const REACTION_MAX_AGE_DAYS = 60; // reactions:summarize が反応を探す期間（06 §6.13.7）

export interface Freshness {
  entries: number;
  oldest?: string;
  newest?: string;
  missing: string[]; // 対象なのにまだ値がない作品、記事の ID
}

export interface ReleaseCheck {
  gameId: string;
  title: string;
  gameStatus: string;
  steamAppId?: number;
  reason: 'date-passed' | 'upcoming' | 'early-access';
  releases: { platform?: string; status: string; date?: string }[];
}

export interface EventCheck {
  eventId: string;
  name: string;
  status: string;
  start: string;
  end: string;
  url: string;
  reasons: ('recheck-due' | 'soon' | 'tentative' | 'ended-no-next')[];
}

export interface SourceStatus {
  sourceId: string;
  kind: string;
  feedUrl?: string;
  displayImages: boolean;
  articles: number;
  latestPublishedAt?: string;
}

export interface RefreshStatus {
  today: string;
  counts: {
    games: Record<string, number>;
    articles: number;
    events: number;
    collections: number;
    openTasks: number;
    pendingReviews: number;
  };
  metrics: {
    popularity: Freshness;
    reviewSummaries: Freshness;
    articleReactions: Freshness;
    palettes: Freshness;
  };
  releases: ReleaseCheck[];
  events: EventCheck[];
  sources: SourceStatus[];
  articleImagesMissing: string[]; // 画像を使ってよい情報源の記事で、画像をまだ保存していないもの
  gamesWithoutCollection: string[]; // 公開中で、どの公開中のコレクションにも入っていない作品
}

function freshness(dates: string[], missing: string[]): Freshness {
  const sorted = [...dates].sort();
  return {
    entries: dates.length,
    ...(sorted.length > 0 ? { oldest: sorted[0], newest: sorted[sorted.length - 1] } : {}),
    missing: missing.sort(),
  };
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

function formatDate(d: PartialDate | undefined): string | undefined {
  return d ? (startOf(d) === endOf(d) ? startOf(d) : `${startOf(d)}..${endOf(d)}`) : undefined;
}

/** 回の番号や年を除いた催しの名前。次の回が登録済みかを調べるのに使う */
function seriesKey(name: string): string {
  return name
    .replace(/[0-9０-９]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** today は日本時間の暦日（YYYY-MM-DD） */
export function refreshStatus(repo: RepoData, today: string): RefreshStatus {
  const active = repo.games.filter((g) => g.status !== 'merged');
  const published = active.filter((g) => g.status === 'published');
  const onSteam = published.filter((g) => g.externalIds.steamAppId);

  const gameCounts: Record<string, number> = {};
  for (const g of repo.games) gameCounts[g.status] = (gameCounts[g.status] ?? 0) + 1;

  // 発売の状態が変わりうる作品（発売予定、早期アクセス）
  const releases: ReleaseCheck[] = [];
  for (const g of active.filter((x) => x.status !== 'hidden')) {
    const adopted = adoptedOf(repo.claims.get(g.id)?.claims ?? [], 'release');
    const pending = adopted.filter((c) => c.value.status === 'upcoming' || c.value.status === 'tba');
    const early = adopted.filter((c) => c.value.status === 'early-access');
    if (pending.length === 0 && early.length === 0) continue;
    const passed = pending.some((c) => c.value.date && endOf(c.value.date) < today);
    releases.push({
      gameId: g.id,
      title: g.title.display,
      gameStatus: g.status,
      ...(g.externalIds.steamAppId ? { steamAppId: g.externalIds.steamAppId } : {}),
      reason: passed ? 'date-passed' : pending.length > 0 ? 'upcoming' : 'early-access',
      releases: [...pending, ...early].map((c) => ({
        ...(c.scope.platform ? { platform: c.scope.platform } : {}),
        status: c.value.status,
        ...(c.value.date ? { date: formatDate(c.value.date) } : {}),
      })),
    });
  }
  const releaseOrder = { 'date-passed': 0, upcoming: 1, 'early-access': 2 };
  releases.sort((a, b) => releaseOrder[a.reason] - releaseOrder[b.reason] || a.gameId.localeCompare(b.gameId));

  // 確かめ直す催し
  const liveEvents = repo.events.filter((e) => e.status !== 'cancelled' && e.status !== 'hidden');
  const soonLimit = addDays(today, EVENT_SOON_DAYS);
  const endedSince = addDays(today, -EVENT_ENDED_DAYS);
  const events: EventCheck[] = [];
  for (const e of liveEvents) {
    const start = startOf(e.start);
    const end = endOf(e.end ?? e.start);
    const reasons: EventCheck['reasons'] = [];
    if (e.recheckAfter && e.recheckAfter <= today) reasons.push('recheck-due');
    if (start >= today && start <= soonLimit) reasons.push('soon');
    if (e.status === 'tentative' && end >= today) reasons.push('tentative');
    if (end < today && end >= endedSince) {
      const key = seriesKey(e.name);
      const hasNext = liveEvents.some((x) => x.id !== e.id && seriesKey(x.name) === key && startOf(x.start) > end);
      if (!hasNext) reasons.push('ended-no-next');
    }
    if (reasons.length > 0) {
      events.push({ eventId: e.id, name: e.name, status: e.status, start, end, url: e.url, reasons });
    }
  }
  events.sort((a, b) => a.start.localeCompare(b.start) || a.eventId.localeCompare(b.eventId));

  // 記事の情報源ごとの最新の掲載日時（新しい記事を探す起点）
  const sources: SourceStatus[] = repo.sources.sources
    .filter((s) => (s.kind === 'media' || s.kind === 'event') && s.rights.allowFetch)
    .map((s) => {
      const own = repo.articles.filter((a) => a.sourceId === s.id);
      const latest = own
        .map((a) => a.publishedAt)
        .filter((d): d is string => !!d)
        .sort()
        .pop();
      return {
        sourceId: s.id,
        kind: s.kind,
        ...(s.fetch.url ? { feedUrl: s.fetch.url } : {}),
        displayImages: s.rights.displayImages,
        articles: own.length,
        ...(latest ? { latestPublishedAt: latest } : {}),
      };
    });

  const imageSources = new Set(
    repo.sources.sources.filter((s) => s.rights.allowFetch && s.rights.displayImages).map((s) => s.id),
  );
  const articleImagesMissing = repo.articles
    .filter((a) => a.status === 'active' && !a.image && a.sourceId && imageSources.has(a.sourceId))
    .map((a) => a.id)
    .sort();

  const reactionSince = new Date(Date.parse(`${today}T00:00:00Z`) - REACTION_MAX_AGE_DAYS * DAY).toISOString();
  const recentArticles = repo.articles.filter(
    (a) => a.status === 'active' && a.publishedAt && a.publishedAt >= reactionSince,
  );

  const pop = repo.popularity.entries;
  const rev = repo.reviewSummaries.entries;
  const rea = repo.articleReactions.entries;
  const pal = repo.palettes.entries;
  const hasHeader = (gameId: string) => adoptedOf(repo.claims.get(gameId)?.claims ?? [], 'image').length > 0;

  const listed = new Set(
    repo.collections.filter((c) => c.status === 'published').flatMap((c) => c.items.map((i) => i.gameId)),
  );

  return {
    today,
    counts: {
      games: gameCounts,
      articles: repo.articles.length,
      events: repo.events.length,
      collections: repo.collections.length,
      openTasks: repo.tasks.tasks.filter((t) => t.status === 'open').length,
      pendingReviews: repo.reviewQueue.items.filter((i) => i.status === 'open').length,
    },
    metrics: {
      popularity: freshness(
        Object.values(pop).map((e) => e.retrievedAt),
        onSteam.filter((g) => !pop[g.id]).map((g) => g.id),
      ),
      reviewSummaries: freshness(
        Object.values(rev).map((e) => e.generatedAt),
        onSteam.filter((g) => !rev[g.id]).map((g) => g.id),
      ),
      articleReactions: freshness(
        Object.values(rea).map((e) => e.retrievedAt),
        recentArticles.filter((a) => !rea[a.id]).map((a) => a.id),
      ),
      palettes: freshness(
        Object.values(pal).map((e) => e.computedAt),
        published.filter((g) => !pal[g.id] && hasHeader(g.id)).map((g) => g.id),
      ),
    },
    releases,
    events,
    sources,
    articleImagesMissing,
    gamesWithoutCollection: published
      .filter((g) => !listed.has(g.id))
      .map((g) => g.id)
      .sort(),
  };
}

export interface UrlLookup {
  url: string;
  urlKey: string;
  articleId?: string; // 同じ URL（canonical、別名を含む）の記事が登録済みなら、その ID
  seen?: string; // state/seen-urls.json での扱い（article、irrelevant など）
}

/** 新しく見つけた記事の URL が、登録済みか、以前に扱ったものかを調べる */
export function lookupUrls(repo: RepoData, urls: string[]): UrlLookup[] {
  const byKey = new Map<string, string>();
  for (const a of repo.articles) {
    for (const u of [a.url, a.canonicalUrl, ...a.urlAliases]) byKey.set(urlKey(u), a.id);
  }
  return urls.map((url) => {
    const key = urlKey(url);
    const articleId = byKey.get(key);
    const seen = repo.seenUrls.entries[key]?.status;
    return { url, urlKey: key, ...(articleId ? { articleId } : {}), ...(seen ? { seen } : {}) };
  });
}

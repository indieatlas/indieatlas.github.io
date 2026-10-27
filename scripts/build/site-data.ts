import type { Article } from '../../schema/article.ts';
import type { Claim, ClaimOf, Evidence } from '../../schema/claim.ts';
import { Platform, Store, TagGroup, type PartialDate } from '../../schema/common.ts';
import type { Game } from '../../schema/game.ts';
import type {
  SiteArticle,
  SiteCollection,
  SiteEvent,
  SiteGame,
  SiteGenre,
  SiteReleaseEntry,
  SiteStats,
  SiteTag,
  SourceRef,
} from '../../schema/site-data.ts';
import { adoptedOf, claimsView } from '../lib/claims-view.ts';
import { todayJst, toJstDate } from '../lib/clock.ts';
import { registrableDomain, storeOf } from '../lib/domains.ts';
import { compare, endOf, format, startOf } from '../lib/partial-date.ts';
import type { RepoData } from '../lib/repo-io.ts';
import { by, cmp } from '../lib/sort.ts';
import { kanaVariants } from '../lib/text-normalize.ts';
import { gameTheme } from './game-theme.ts';
import { releaseEntryLabel, releaseLabel, STORE_LABELS } from './labels.ts';

export interface SiteDataSet {
  games: SiteGame[];
  events: SiteEvent[];
  genres: SiteGenre[];
  redirects: { from: string; to: string }[];
  articles: SiteArticle[];
  collections: SiteCollection[];
  tags: SiteTag[];
  stats: SiteStats;
}

const MAX_TAGS = 12;
const MAX_RELATED = 6;
const STATUS_PRIORITY = ['released', 'early-access', 'upcoming', 'tba', 'cancelled', 'delisted'] as const;
const STORE_ORDER = Store.options;
const PLATFORM_ORDER = Platform.options;
const GROUP_ORDER = TagGroup.options;
const IMAGE_ROLES = ['header', 'capsule', 'keyart'] as const;

const ENRICH_NOTES: Record<string, string> = {
  release: '発売日が更新',
  japaneseSupport: '日本語対応を確認',
  playerModes: 'プレイ形式を確認',
  summary: '紹介文を追加',
  features: '特徴を追加',
  image: '画像を追加',
  article: '紹介記事を追加',
};

const dateOnly = (iso: string) => toJstDate(new Date(iso));

/** data/ から、公開してよい項目だけを表示用の形にする（03 §3.7） */
export function buildSiteData(repo: RepoData, today = todayJst()): SiteDataSet {
  const published = repo.games.filter((g) => g.status === 'published');
  const publishedIds = new Set(published.map((g) => g.id));
  const devById = new Map(repo.developers.map((d) => [d.id, d]));
  const sourceById = new Map(repo.sources.sources.map((s) => [s.id, s]));
  const articleById = new Map(repo.articles.map((a) => [a.id, a]));
  const tagById = new Map(repo.tags.tags.map((t) => [t.id, t]));
  const claimsOf = (id: string): Claim[] => repo.claims.get(id)?.claims ?? [];

  // 表示するタグ: core と、公開中の作品の一定数以上に付いた candidate（05 §5.7）
  const tagUse = new Map<string, number>();
  for (const g of published) {
    for (const id of claimsView(claimsOf(g.id)).tagIds) tagUse.set(id, (tagUse.get(id) ?? 0) + 1);
  }
  const visibleTag = (id: string): boolean => {
    const t = tagById.get(id);
    if (!t || t.status === 'deprecated') return false;
    return t.status === 'core' || (tagUse.get(id) ?? 0) >= repo.runtime.publish.candidateTagMinGames;
  };

  const sourceLabel = (e: Evidence): string => {
    if (e.articleId) {
      const a = articleById.get(e.articleId);
      if (a) return a.outlet.name;
    }
    if (e.sourceId) {
      const s = sourceById.get(e.sourceId);
      if (s) return s.name;
    }
    if (registrableDomain(e.url) === 'igdb.com') return 'IGDB';
    const store = storeOf(e.url);
    if (store && store in STORE_LABELS) return STORE_LABELS[store as keyof typeof STORE_LABELS];
    return registrableDomain(e.url);
  };
  const refs = (claims: Claim[]): SourceRef[] => {
    const out = new Map<string, SourceRef>();
    for (const c of claims) {
      for (const e of c.evidence) {
        const prev = out.get(e.url);
        const checkedAt = c.lastCheckedAt > e.retrievedAt ? c.lastCheckedAt : e.retrievedAt;
        if (prev && prev.checkedAt >= checkedAt) continue;
        out.set(e.url, {
          label: sourceLabel(e),
          url: e.url,
          kind: e.kind,
          ...(e.publishedAt ? { publishedAt: e.publishedAt } : {}),
          checkedAt,
        });
      }
    }
    return [...out.values()].sort(
      by(
        (r) => r.label,
        (r) => r.url,
      ),
    );
  };

  // 記事
  const siteArticles: SiteArticle[] = repo.articles
    .filter((a) => a.status === 'active' && a.games.some((g) => publishedIds.has(g.gameId)))
    .map((a) => toSiteArticle(a, publishedIds, sourceById))
    .sort(
      by(
        (a) => invert(a.publishedAt ?? ''),
        (a) => a.id,
      ),
    );
  const articlesByGame = new Map<string, { id: string; role: Article['games'][number]['role'] }[]>();
  for (const a of siteArticles) {
    for (const g of a.games) {
      const list = articlesByGame.get(g.gameId) ?? [];
      list.push({ id: a.id, role: g.role });
      articlesByGame.set(g.gameId, list);
    }
  }

  // コレクション
  const publishedCollections = repo.collections.filter((c) => c.status === 'published');
  const collectionsByGame = new Map<string, string[]>();
  for (const c of publishedCollections) {
    for (const i of c.items) {
      if (!publishedIds.has(i.gameId)) continue;
      collectionsByGame.set(i.gameId, [...(collectionsByGame.get(i.gameId) ?? []), c.id]);
    }
  }

  const games: SiteGame[] = published.map((g) => {
    const claims = claimsOf(g.id);
    const view = claimsView(claims);
    const release = buildRelease(claims, refs);
    const ja = pickJapaneseSupport(adoptedOf(claims, 'japaneseSupport'));
    const modes = adoptedOf(claims, 'playerModes')[0];
    const summary = adoptedOf(claims, 'summary')[0];
    const features = adoptedOf(claims, 'features')[0];
    const tagClaims = adoptedOf(claims, 'tag').filter((c) => visibleTag(c.value.tagId));
    const tags = tagClaims
      .map((c) => tagById.get(c.value.tagId)!)
      .sort(
        by(
          (t) => GROUP_ORDER.indexOf(t.group),
          (t) => t.id,
        ),
      )
      .slice(0, MAX_TAGS)
      .map((t) => ({ id: t.id, label: t.label.ja, group: t.group }));
    const storeClaims = adoptedOf(claims, 'storeLink');
    const stores = dedupeBy(storeClaims, (c) => c.value.url)
      .sort(
        by(
          (c) => STORE_ORDER.indexOf(c.value.store),
          (c) => c.value.url,
        ),
      )
      .map((c) => ({
        store: c.value.store,
        url: c.value.url,
        ...(c.scope.platform ? { platform: c.scope.platform } : {}),
        sources: refs([c]),
      }));
    const image = pickImage(adoptedOf(claims, 'image'), g);
    const screenshots = adoptedOf(claims, 'image')
      .filter((c) => c.value.role === 'screenshot')
      .map((c) => ({
        url: c.value.url,
        // IGDB の画像は、URL の大きさの指定を変えると大きな版になる
        large: c.value.url.replace('/t_screenshot_big/', '/t_1080p/'),
        ...(c.value.width ? { width: c.value.width } : {}),
        ...(c.value.height ? { height: c.value.height } : {}),
        alt: c.value.alt ?? `${g.title.display} のスクリーンショット`,
        ...(c.value.usage.credit ? { credit: c.value.usage.credit } : {}),
      }));
    const articles = articlesByGame.get(g.id) ?? [];
    const enriched = enrichment(g, claims, articles, articleById);
    const filledFields = [
      release && release.entries.length > 0,
      ja,
      modes,
      summary,
      features,
      tags.length >= 3,
      image,
    ].filter(Boolean).length;
    const updatedAt = [g.updatedAt, ...claims.map((c) => c.updatedAt)].reduce((m, x) => (x > m ? x : m));
    return {
      id: g.id,
      path: `/games/${g.id}/`,
      title: { ...g.title },
      aliases: searchAliases(g),
      developers: g.developerIds.map((id) => ({ id, name: devById.get(id)?.name.display ?? id })),
      publishers: g.publisherIds.map((id) => ({ id, name: devById.get(id)?.name.display ?? id })),
      addedAt: g.addedAt!,
      updatedAt: dateOnly(updatedAt),
      ...enriched,
      release,
      platforms: [...view.platforms].sort((a, b) => PLATFORM_ORDER.indexOf(a) - PLATFORM_ORDER.indexOf(b)),
      japaneseSupport: ja
        ? {
            interface: ja.value.interface,
            subtitles: ja.value.subtitles,
            audio: ja.value.audio,
            ...(ja.scope.platform ? { platform: ja.scope.platform } : {}),
            sources: refs([ja]),
          }
        : null,
      playerModes: modes ? { ...modes.value, sources: refs([modes]) } : null,
      summary: summary ? { text: summary.value.ja, sources: refs([summary]) } : null,
      features: features ? { items: [...features.value.ja], sources: refs([features]) } : null,
      tags,
      tagSources: refs(tagClaims),
      stores,
      ...(g.officialUrl ? { officialUrl: g.officialUrl } : {}),
      ...(image ? { image } : {}),
      screenshots,
      ...paletteOf(g, image?.url, repo),
      ...(primaryGenre(tags, tagUse) ? { primaryGenre: primaryGenre(tags, tagUse) } : {}),
      articles,
      related: [],
      collections: collectionsByGame.get(g.id) ?? [],
      coverage: { articleCount: articles.length, filledFields },
    };
  });

  // 関連作品: 保存された関係と、同じ開発者の作品（04 §4.7.2）
  const gameById = new Map(games.map((g) => [g.id, g]));
  for (const r of repo.relations.relations) {
    if (r.status !== 'adopted' || !publishedIds.has(r.a) || !publishedIds.has(r.b)) continue;
    gameById.get(r.a)!.related.push({ gameId: r.b, kind: r.kind, reason: r.reason });
    gameById.get(r.b)!.related.push({ gameId: r.a, kind: r.kind, reason: r.reason });
  }
  for (const g of published) {
    const site = gameById.get(g.id)!;
    for (const other of published) {
      if (other.id === g.id || site.related.some((r) => r.gameId === other.id)) continue;
      const shared = g.developerIds.filter((d) => other.developerIds.includes(d));
      if (shared.length === 0) continue;
      const name = devById.get(shared[0]!)?.name.display ?? shared[0]!;
      site.related.push({ gameId: other.id, kind: 'same-developer', reason: `同じ開発者（${name}）による作品。` });
    }
    site.related = site.related.slice(0, MAX_RELATED);
  }

  const collections: SiteCollection[] = publishedCollections
    .map((c) => {
      let items = c.items.filter((i) => publishedIds.has(i.gameId));
      if (c.order === 'added-desc')
        items = [...items].sort(
          by(
            (i) => invert(i.addedAt),
            (i) => i.gameId,
          ),
        );
      else if (c.order === 'release-desc') {
        items = [...items].sort(
          by(
            (i) => invert(gameById.get(i.gameId)?.release?.overall.sortKey ?? ''),
            (i) => i.gameId,
          ),
        );
      } else
        items = [...items].sort(
          by(
            (i) => i.position,
            (i) => i.gameId,
          ),
        );
      return {
        id: c.id,
        path: `/collections/${c.id}/`,
        title: c.title,
        lede: c.lede,
        description: c.description,
        criteria: c.criteria.text,
        featured: c.featured,
        updatedAt: dateOnly(c.updatedAt),
        items: items.map((i) => ({ gameId: i.gameId, reason: i.reason })),
      };
    })
    .sort(by((c) => c.id));

  const tags: SiteTag[] = repo.tags.tags
    .filter((t) => visibleTag(t.id))
    .map((t) => ({
      id: t.id,
      label: t.label.ja,
      labelEn: t.label.en,
      group: t.group,
      aliases: t.aliases,
      gameCount: tagUse.get(t.id) ?? 0,
    }))
    .sort(
      by(
        (t) => GROUP_ORDER.indexOf(t.group),
        (t) => t.id,
      ),
    );

  const redirects = repo.games
    .filter((g) => g.status === 'merged' && g.mergedInto && publishedIds.has(g.mergedInto))
    .map((g) => ({ from: g.id, to: g.mergedInto! }))
    .sort(by((r) => r.from));

  // 主なジャンルの上位8件（カテゴリ色の割り当てに使う）
  const genreCount = new Map<string, number>();
  for (const g of games) if (g.primaryGenre) genreCount.set(g.primaryGenre, (genreCount.get(g.primaryGenre) ?? 0) + 1);
  const genres: SiteGenre[] = [...genreCount.entries()]
    .sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))
    .slice(0, 8)
    .map(([id]) => ({ id, label: tagById.get(id)?.label.ja ?? id }));

  const lastUpdated = games.reduce((m, g) => (g.updatedAt > m ? g.updatedAt : m), '');
  return {
    games: games.sort(by((g) => g.id)),
    events: repo.events
      .filter((e) => e.status !== 'hidden' && e.status !== 'cancelled')
      .map((e) => ({
        id: e.id,
        name: e.name,
        ...(e.nameEn ? { nameEn: e.nameEn } : {}),
        kind: e.kind,
        format: e.format,
        start: e.start,
        ...(e.end ? { end: e.end } : {}),
        startKey: startOf(e.start),
        endKey: endOf(e.end ?? e.start),
        dateLabel: eventDateLabel(e.start, e.end),
        ...(e.time ? { time: e.time } : {}),
        ...(e.location ? { location: e.location } : {}),
        url: e.url,
        summary: e.summary,
        tentative: e.status === 'tentative',
        phase: phaseOf(startOf(e.start), endOf(e.end ?? e.start), today),
        games: e.games.filter((id) => publishedIds.has(id)),
        sources: refs([{ evidence: e.evidence, lastCheckedAt: e.updatedAt } as unknown as Claim]),
      }))
      .sort(
        by(
          (e) => e.startKey,
          (e) => e.id,
        ),
      ),
    genres,
    redirects,
    articles: siteArticles,
    collections,
    tags,
    stats: {
      games: games.length,
      articles: siteArticles.length,
      collections: collections.length,
      tags: tags.length,
      lastUpdated,
    },
  };
}

/** 文字列の降順の並べ替えに使う（空文字は最後） */
function invert(s: string): string {
  if (!s) return '￿';
  return [...s].map((c) => String.fromCharCode(0xffff - c.charCodeAt(0))).join('');
}

function dedupeBy<T>(items: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((x) => {
    const k = key(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function toSiteArticle(
  a: Article,
  publishedIds: Set<string>,
  sourceById: Map<string, RepoData['sources']['sources'][number]>,
): SiteArticle {
  const rights = a.sourceId ? sourceById.get(a.sourceId)?.rights : undefined;
  const showTitle = rights ? rights.displayTitle : true;
  const showSummary = rights ? rights.displaySummary : false;
  return {
    id: a.id,
    url: a.canonicalUrl,
    title: showTitle ? a.title : null,
    lang: a.lang,
    kind: a.kind,
    outlet: { ...a.outlet },
    ...(a.publishedAt ? { publishedAt: a.publishedAt } : {}),
    ...(showSummary && a.summaryJa ? { summaryJa: a.summaryJa } : {}),
    ...(a.image && (rights ? rights.displayImages : false)
      ? { image: { path: a.image.path, width: a.image.width, height: a.image.height } }
      : {}),
    games: a.games.filter((g) => publishedIds.has(g.gameId)).map((g) => ({ gameId: g.gameId, role: g.role })),
  };
}

function buildRelease(claims: Claim[], refs: (c: Claim[]) => SourceRef[]): SiteGame['release'] {
  const adopted = adoptedOf(claims, 'release');
  const conflicted = claims.some((c) => c.field === 'release' && c.status === 'conflicted');
  if (adopted.length === 0) {
    return conflicted
      ? { overall: { status: 'tba', label: '確認中' }, entries: [], history: [], conflicted: true }
      : null;
  }
  const entries: SiteReleaseEntry[] = adopted
    .map((c) => ({
      platform: c.scope.platform ?? 'other',
      region: c.scope.region ?? 'global',
      status: c.value.status,
      ...(c.value.date ? { date: c.value.date } : {}),
      ...(c.value.rawText ? { rawText: c.value.rawText } : {}),
      label: releaseEntryLabel(c.value.status, c.value.date),
      sources: refs([c]),
    }))
    .sort((a, b) => PLATFORM_ORDER.indexOf(a.platform) - PLATFORM_ORDER.indexOf(b.platform) || cmp(a.region, b.region));
  const overall = overallRelease(entries);
  const history = claims
    .filter((c): c is ClaimOf<'release'> => c.field === 'release' && c.status === 'superseded')
    .sort(
      by(
        (c) => c.asOf,
        (c) => c.id,
      ),
    )
    .map((c) => ({
      platform: c.scope.platform ?? 'other',
      label: releaseEntryLabel(c.value.status, c.value.date),
      asOf: c.asOf,
      sources: refs([c]),
    }));
  return { overall, entries, history, conflicted: false };
}

/** 全体の発売状況（02 §2.4.2 の優先順位） */
export function overallRelease(entries: SiteReleaseEntry[]): NonNullable<SiteGame['release']>['overall'] {
  for (const status of STATUS_PRIORITY) {
    const hits = entries.filter((e) => e.status === status);
    if (hits.length === 0) continue;
    // 開発中止と配信終了は、全機種がその状態の場合だけ
    if ((status === 'cancelled' || status === 'delisted') && hits.length !== entries.length) continue;
    const dated = hits.filter((e) => e.date).sort((a, b) => compare(a.date!, b.date!));
    const date: PartialDate | undefined = dated[0]?.date;
    return { status, label: releaseLabel(status, date), ...(date ? { sortKey: startOf(date) } : {}) };
  }
  const first = entries[0]!;
  return { status: first.status, label: releaseLabel(first.status, first.date) };
}

function pickJapaneseSupport(claims: ClaimOf<'japaneseSupport'>[]): ClaimOf<'japaneseSupport'> | undefined {
  return claims.find((c) => !c.scope.platform) ?? claims[0];
}

function pickImage(claims: ClaimOf<'image'>[], g: Game): SiteGame['image'] {
  for (const role of IMAGE_ROLES) {
    const c = claims.find((x) => x.value.role === role);
    if (!c) continue;
    return {
      url: c.value.url,
      ...(c.value.width ? { width: c.value.width } : {}),
      ...(c.value.height ? { height: c.value.height } : {}),
      alt: c.value.alt ?? `${g.title.display} の画像`,
      ...(c.value.usage.credit ? { credit: c.value.usage.credit } : {}),
    };
  }
  return undefined;
}

/** 主なジャンル: 作品のジャンル系タグのうち、付いている作品が最も少ない（最も特徴的な）もの */
function primaryGenre(tags: SiteGame['tags'], tagUse: Map<string, number>): string | undefined {
  return tags
    .filter((t) => t.group === 'genre')
    .sort(
      by(
        (t) => tagUse.get(t.id) ?? 0,
        (t) => t.id,
      ),
    )[0]?.id;
}

/** 索引用の別名。表示名と読みの仮名の相互変換も加える（03 §3.6） */
function searchAliases(g: Game): string[] {
  const out = new Set<string>();
  if (g.title.original !== g.title.display) out.add(g.title.original);
  for (const a of g.aliases) out.add(a.value);
  for (const v of kanaVariants(g.title.display)) out.add(v);
  for (const a of g.aliases)
    if (a.kind === 'reading' || a.kind === 'localized') for (const v of kanaVariants(a.value)) out.add(v);
  out.delete(g.title.display);
  return [...out];
}

/** 最近情報が充実した日と、その内容（04 §4.9） */
function enrichment(
  g: Game,
  claims: Claim[],
  articles: { id: string; role: string }[],
  articleById: Map<string, Article>,
): { enrichedAt?: string; enrichedNote?: string } {
  if (!g.addedAt) return {};
  let best: { date: string; note: string } | undefined;
  const consider = (date: string, note: string) => {
    if (date <= g.addedAt!) return;
    if (!best || date > best.date) best = { date, note };
  };
  for (const c of claims) {
    if (c.status !== 'adopted' || !c.adoptedAt) continue;
    const note = ENRICH_NOTES[c.field];
    if (note && c.field !== 'tag' && c.field !== 'storeLink') consider(dateOnly(c.adoptedAt), note);
  }
  for (const a of articles) {
    if (a.role !== 'primary') continue;
    const art = articleById.get(a.id);
    if (art) consider(dateOnly(art.createdAt), ENRICH_NOTES.article!);
  }
  return best ? { enrichedAt: best.date, enrichedNote: best.note } : {};
}

/** 画像から抽出した色と、それから作るページの色。画像が変わっていれば使わない */
function paletteOf(g: Game, imageUrl: string | undefined, repo: RepoData): Pick<SiteGame, 'palette' | 'theme'> {
  const p = repo.palettes.entries[g.id];
  if (!p || !imageUrl || p.imageUrl !== imageUrl) return {};
  const theme = gameTheme(p.colors);
  return { palette: p.colors, ...(theme ? { theme } : {}) };
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function withWeekday(d: PartialDate): string {
  if (d.precision !== 'day') return format(d);
  const w = new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
  return `${format(d)}（${WEEKDAYS[w]}）`;
}

/** 催しの日程の表記。終わりの日が同じ年なら年を省く */
export function eventDateLabel(start: PartialDate, end?: PartialDate): string {
  if (!end || startOf(end) === startOf(start)) return withWeekday(start);
  const e = withWeekday(end);
  return `${withWeekday(start)}〜${end.year === start.year ? e.replace(/^\d+年/, '') : e}`;
}

function phaseOf(start: string, end: string, today: string): 'upcoming' | 'ongoing' | 'past' {
  if (end < today) return 'past';
  if (start <= today) return 'ongoing';
  return 'upcoming';
}

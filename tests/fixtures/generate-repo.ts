/**
 * tests/fixtures/repo/ の架空のデータ一式を作る（10 §10.5.1）。
 * 実在しない作品と媒体だけを使い、ドメインは例示用のものにする。
 *
 *   npx tsx tests/fixtures/generate-repo.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { Article } from '../../schema/article.ts';
import type { Claim, ClaimsFile, Evidence } from '../../schema/claim.ts';
import { ClaimsFile as ClaimsFileSchema } from '../../schema/claim.ts';
import { Collection } from '../../schema/collection.ts';
import { RuntimeConfig, SourcesFile } from '../../schema/config.ts';
import { Developer } from '../../schema/developer.ts';
import { Game } from '../../schema/game.ts';
import { GameRelationsFile } from '../../schema/relation.ts';
import { PopularityMetrics } from '../../schema/media.ts';
import { ReviewQueue, SeenUrls, TasksFile } from '../../schema/state.ts';
import { TagsFile } from '../../schema/taxonomy.ts';
import { makeClaim, supersede } from '../../scripts/lib/claim-builder.ts';
import { articleId, relationId, taskId, urlKey } from '../../scripts/lib/ids.ts';
import { PROJECT_ROOT, readJson, writeJson } from '../../scripts/lib/repo-io.ts';
import {
  sortArticle,
  sortClaimsFile,
  sortCollection,
  sortGame,
  sortRelations,
  sortTags,
  sortTasks,
} from '../../scripts/lib/sort.ts';

const ROOT = path.join(PROJECT_ROOT, 'tests/fixtures/repo');
const AT = '2026-10-27T00:31:40Z';
const RUN = 'local-fixture';
const by = 'human' as const;

fs.rmSync(ROOT, { recursive: true, force: true });
const out = (...p: string[]) => path.join(ROOT, ...p);

// 設定
writeJson(RuntimeConfig, out('config/runtime.json'), readJson(RuntimeConfig, path.join(PROJECT_ROOT, 'config/runtime.json')));
writeJson(SourcesFile, out('config/sources.json'), {
  schemaVersion: 1,
  sources: [
    {
      id: 'example-news-jp',
      name: 'Example News',
      homepage: 'https://news.example.jp/',
      lang: 'ja',
      role: 'understand',
      kind: 'media',
      evidenceKind: 'media',
      enabled: true,
      fetch: { method: 'rss', url: 'https://news.example.jp/feed/indie.xml', frequency: 'every-run', maxItemsPerRun: 20 },
      filters: { excludeCategories: ['セール情報'] },
      rights: {
        termsUrl: 'https://news.example.jp/terms/',
        checkedAt: '2026-10-27',
        checkedBy: 'operator',
        allowFetch: true,
        displayTitle: true,
        displaySummary: true,
        displayImages: false,
        storeQuotes: true,
        notes: '見出しとリンクの掲載は可。記事画像の転載は不可。',
      },
    },
  ],
});
fs.writeFileSync(out('config/policy.md'), '# Indie Atlas 運営方針（テスト用）\n');

// タグ: 本番の core タグから、フィクスチャで使うものだけを写す
const usedTags = [
  'adventure', 'exploration', 'ocean', 'pixel-art', 'puzzle', 'roguelike', 'deck-building', 'platformer',
  'cozy', 'crafting', 'fantasy', 'farming-sim', 'nature', 'difficult', 'magic',
];
const realTags = readJson(TagsFile, path.join(PROJECT_ROOT, 'data/taxonomy/tags.json'));
writeJson(TagsFile, out('data/taxonomy/tags.json'), sortTags({
  schemaVersion: 1,
  tags: realTags.tags.filter((t) => usedTags.includes(t.id)),
}));

// 開発者
const devs: [string, string, string?][] = [
  ['dev_000001', 'Small Harbor Games', 'https://smallharbor.example.com/'],
  ['dev_000002', 'Quiet Bell Studio'],
  ['dev_000003', 'Northwind Interactive'],
  ['dev_000004', 'アトリエほしくず', 'https://stardust-atelier.example.jp/'],
  ['dev_000005', 'Paper Lantern Works'],
  ['dev_000006', 'Mossy Stone'],
];
for (const [id, name, url] of devs) {
  writeJson(Developer, out(`data/developers/${id}.json`), {
    schemaVersion: 1,
    id,
    name: { display: name, original: name },
    aliases: [],
    roles: ['developer', 'publisher'],
    ...(url ? { officialUrl: url } : {}),
    links: [],
    independence: { status: 'unknown', setBy: 'system', evidence: [] },
    createdAt: AT,
    updatedAt: AT,
    createdByRun: RUN,
  });
}

// 根拠
const steamEv = (appId: number, locator: string, at = '2026-10-20T00:20:11Z'): Evidence => ({
  kind: 'store',
  url: `https://store.steampowered.com/app/${appId}/`,
  retrievedAt: at,
  locator,
  originKey: 'store:steam',
});
const officialEv = (url: string, quote: string, publishedAt: string, at: string): Evidence => ({
  kind: 'official',
  url,
  publishedAt,
  retrievedAt: at,
  quote,
  originKey: `official:${new URL(url).hostname.split('.').slice(-2).join('.')}`,
});

interface FixtureGame {
  id: string;
  status: Game['status'];
  display: string;
  original: string;
  lang: string;
  aliases?: Game['aliases'];
  steam?: number;
  official?: string;
  devs: string[];
  addedAt?: string;
  mergedInto?: string;
  disambiguation?: string;
  associatedApps?: Game['associatedApps'];
  claims: (gameId: string) => Claim[];
}

const common = (gameId: string, appId: number) => ({ gameId, at: AT, createdBy: by, createdByRun: RUN, evidence: [steamEv(appId, 'steam:appdetails')] });
const summary = (gameId: string, appId: number, ja: string) =>
  makeClaim({ ...common(gameId, appId), field: 'summary', value: { ja }, asOf: '2026-10-20' });
const features = (gameId: string, appId: number, ja: string[]) =>
  makeClaim({ ...common(gameId, appId), field: 'features', value: { ja }, asOf: '2026-10-20' });
const tags = (gameId: string, appId: number, ids: string[]) =>
  ids.map((tagId) => makeClaim({ ...common(gameId, appId), field: 'tag', value: { tagId }, asOf: '2026-10-20' }));
const steamLink = (gameId: string, appId: number) =>
  makeClaim({
    ...common(gameId, appId),
    field: 'storeLink',
    value: { store: 'steam', url: `https://store.steampowered.com/app/${appId}/` },
    asOf: '2026-10-20',
  });
const released = (gameId: string, appId: number, platform: 'pc' | 'switch', y: number, m: number, d: number, status: 'released' | 'early-access' = 'released') =>
  makeClaim({
    ...common(gameId, appId),
    evidence: [steamEv(appId, 'steam:appdetails.release_date.date')],
    field: 'release',
    scope: { platform, region: 'global' },
    value: { status, date: { precision: 'day', year: y, month: m, day: d } },
    asOf: '2026-10-20',
  });
const ja = (gameId: string, appId: number, v: 'yes' | 'no' | 'planned') =>
  makeClaim({
    ...common(gameId, appId),
    evidence: [steamEv(appId, 'steam:store.language_table')],
    field: 'japaneseSupport',
    value: { interface: v, subtitles: v, audio: 'no' },
    asOf: '2026-10-20',
  });

// F07: 延期。PC 版は「2026年冬」から「2027年春」へ。Switch 版は「2027年」のまま
function lanternTideClaims(gameId: string): Claim[] {
  const old = makeClaim({
    gameId,
    field: 'release',
    scope: { platform: 'pc', region: 'global' },
    value: { status: 'upcoming', date: { precision: 'season', year: 2026, season: 'winter' }, rawText: 'Winter 2026' },
    evidence: [
      officialEv('https://lanterntide.example.com/news/release-window', 'Lantern Tide launches on PC in Winter 2026.', '2026-06-10', '2026-06-11T00:18:02Z'),
    ],
    asOf: '2026-06-10',
    at: '2026-06-11T00:30:00Z',
    createdBy: by,
    createdByRun: RUN,
  });
  const next = makeClaim({
    gameId,
    field: 'release',
    scope: { platform: 'pc', region: 'global' },
    value: { status: 'upcoming', date: { precision: 'season', year: 2027, season: 'spring' }, rawText: 'Spring 2027' },
    evidence: [
      officialEv(
        'https://lanterntide.example.com/news/new-release-window',
        'we have decided to move the PC launch of Lantern Tide to Spring 2027',
        '2026-10-24',
        '2026-10-27T00:22:15Z',
      ),
    ],
    asOf: '2026-10-24',
    at: AT,
    createdBy: by,
    createdByRun: RUN,
  });
  supersede(old, next, AT);
  const sw = makeClaim({
    gameId,
    field: 'release',
    scope: { platform: 'switch', region: 'global' },
    value: { status: 'upcoming', date: { precision: 'year', year: 2027 }, rawText: '2027' },
    evidence: [officialEv('https://lanterntide.example.com/news/release-window', 'The Nintendo Switch version follows in 2027.', '2026-06-10', '2026-06-11T00:18:02Z')],
    asOf: '2026-06-10',
    at: '2026-06-11T00:30:00Z',
    createdBy: by,
    createdByRun: RUN,
  });
  return [
    old,
    next,
    sw,
    ja(gameId, 900001, 'yes'),
    makeClaim({ ...common(gameId, 900001), field: 'playerModes', value: { modes: ['single'] }, asOf: '2026-10-20' }),
    summary(gameId, 900001, '灯台守の少女となり、潮の満ち引きで姿を変える群島を探索する海洋アドベンチャー。満潮と干潮で道や遺跡の現れ方が変わり、島々の秘密を少しずつ解き明かしていく。'),
    features(gameId, 900001, ['潮の満ち引きで地形が変わる群島を探索できる', '灯台に光を灯すと新しい航路が開ける', '手描きのドット絵で描かれた海と空']),
    ...tags(gameId, 900001, ['adventure', 'exploration', 'ocean', 'pixel-art']),
    steamLink(gameId, 900001),
    makeClaim({
      ...common(gameId, 900001),
      field: 'image',
      value: {
        url: 'https://lanterntide.example.com/press/header.jpg',
        role: 'header',
        width: 460,
        height: 215,
        alt: 'Lantern Tide のキーアート',
        usage: { basis: 'official-press-kit', credit: 'Small Harbor Games' },
      },
      asOf: '2026-10-20',
    }),
  ];
}

const games: FixtureGame[] = [
  {
    // F01、F04、F05
    id: 'g_000001',
    status: 'published',
    display: 'ランタンタイド',
    original: 'Lantern Tide',
    lang: 'en',
    aliases: [
      { value: 'ランタン・タイド', lang: 'ja', kind: 'localized' },
      { value: 'らんたんたいど', lang: 'ja', kind: 'reading' },
    ],
    steam: 900001,
    official: 'https://lanterntide.example.com/',
    devs: ['dev_000001'],
    addedAt: '2026-10-20',
    associatedApps: [
      { store: 'steam', id: '900002', kind: 'demo', title: 'Lantern Tide Demo' },
      { store: 'steam', id: '900003', kind: 'dlc', title: 'Lantern Tide - Deep Currents' },
    ],
    claims: lanternTideClaims,
  },
  {
    // F02: 同名作品（1）
    id: 'g_000002',
    status: 'published',
    display: 'Echoes',
    original: 'Echoes',
    lang: 'en',
    steam: 900010,
    devs: ['dev_000002'],
    addedAt: '2026-10-21',
    disambiguation: 'Quiet Bell Studio の音のパズル。Northwind Interactive の Echoes とは別作品',
    claims: (id) => [
      released(id, 900010, 'pc', 2025, 4, 2),
      summary(id, 900010, '反響する音を手がかりに、暗い建物の中で道筋を探すパズルゲーム。音が壁に当たって返ってくるまでの時間から、部屋の形を思い描いて進む。'),
      ...tags(id, 900010, ['puzzle']),
      steamLink(id, 900010),
    ],
  },
  {
    // F02: 同名作品（2）
    id: 'g_000003',
    status: 'published',
    display: 'Echoes',
    original: 'Echoes',
    lang: 'en',
    steam: 900020,
    devs: ['dev_000003'],
    addedAt: '2026-10-22',
    disambiguation: 'Northwind Interactive のローグライク。Quiet Bell Studio の Echoes とは別作品',
    claims: (id) => [
      released(id, 900020, 'pc', 2024, 11, 8),
      released(id, 900020, 'switch', 2025, 3, 13),
      ja(id, 900020, 'no'),
      summary(id, 900020, '過去の自分の動きが残像として残るローグライクアクション。倒れるたびに前の挑戦の残像が味方として戦い、少しずつ深い階層へ進む。'),
      ...tags(id, 900020, ['roguelike', 'platformer', 'difficult']),
      steamLink(id, 900020),
    ],
  },
  {
    // F03: 和英のタイトル
    id: 'g_000004',
    status: 'published',
    display: '星屑のアトリエ',
    original: '星屑のアトリエ',
    lang: 'ja',
    aliases: [
      { value: 'Stardust Atelier', lang: 'en', kind: 'localized' },
      { value: 'ほしくずのあとりえ', lang: 'ja', kind: 'reading' },
    ],
    official: 'https://stardust-atelier.example.jp/',
    devs: ['dev_000004'],
    addedAt: '2026-10-23',
    claims: (id) => [
      makeClaim({
        gameId: id,
        field: 'release',
        scope: { platform: 'pc', region: 'global' },
        value: { status: 'released', date: { precision: 'day', year: 2026, month: 3, day: 5 } },
        evidence: [officialEv('https://stardust-atelier.example.jp/news/launch', '『星屑のアトリエ』本日発売。Stardust Atelier is out now.', '2026-03-05', '2026-10-23T00:10:00Z')],
        asOf: '2026-03-05',
        at: AT,
        createdBy: by,
        createdByRun: RUN,
      }),
      makeClaim({
        gameId: id,
        field: 'japaneseSupport',
        value: { interface: 'yes', subtitles: 'yes', audio: 'yes' },
        evidence: [officialEv('https://stardust-atelier.example.jp/', '日本語音声・日本語字幕に対応しています。', '2026-03-05', '2026-10-23T00:10:00Z')],
        asOf: '2026-03-05',
        at: AT,
        createdBy: by,
        createdByRun: RUN,
      }),
      makeClaim({
        gameId: id,
        field: 'summary',
        value: { ja: '星屑を集めて道具を作り、小さな工房を切り盛りするスローライフ作品。依頼をこなすほど町の人との交流が増え、工房の設備も広がっていく。' },
        evidence: [officialEv('https://stardust-atelier.example.jp/', '星屑を集めて、工房で道具を作ろう。', '2026-03-05', '2026-10-23T00:10:00Z')],
        asOf: '2026-03-05',
        at: AT,
        createdBy: by,
        createdByRun: RUN,
      }),
      ...['cozy', 'crafting', 'farming-sim', 'fantasy', 'magic'].map((tagId) =>
        makeClaim({
          gameId: id,
          field: 'tag',
          value: { tagId },
          evidence: [officialEv('https://stardust-atelier.example.jp/', '星屑を集めて、工房で道具を作ろう。', '2026-03-05', '2026-10-23T00:10:00Z')],
          asOf: '2026-03-05',
          at: AT,
          createdBy: by,
          createdByRun: RUN,
        }),
      ),
      makeClaim({
        gameId: id,
        field: 'storeLink',
        value: { store: 'official', url: 'https://stardust-atelier.example.jp/buy' },
        evidence: [officialEv('https://stardust-atelier.example.jp/', '星屑を集めて、工房で道具を作ろう。', '2026-03-05', '2026-10-23T00:10:00Z')],
        asOf: '2026-03-05',
        at: AT,
        createdBy: by,
        createdByRun: RUN,
      }),
    ],
  },
  {
    // F06: 続編は別の作品（candidate のまま）
    id: 'g_000005',
    status: 'candidate',
    display: 'Lantern Tide 2',
    original: 'Lantern Tide 2',
    lang: 'en',
    steam: 900004,
    devs: ['dev_000001'],
    claims: (id) => [
      makeClaim({
        ...common(id, 900004),
        field: 'release',
        scope: { platform: 'pc', region: 'global' },
        value: { status: 'tba' },
        asOf: '2026-10-20',
      }),
    ],
  },
  {
    id: 'g_000006',
    status: 'published',
    display: 'デッキバウンド・デプス',
    original: 'Deckbound Depths',
    lang: 'en',
    aliases: [{ value: 'でっきばうんど', lang: 'ja', kind: 'reading' }],
    steam: 900030,
    devs: ['dev_000005'],
    addedAt: '2026-10-24',
    claims: (id) => [
      released(id, 900030, 'pc', 2025, 9, 18),
      released(id, 900030, 'switch', 2026, 1, 22),
      ja(id, 900030, 'yes'),
      makeClaim({ ...common(id, 900030), field: 'playerModes', value: { modes: ['single'] }, asOf: '2026-10-20' }),
      summary(id, 900030, '紙で作られた地下迷宮を、カードの山札を育てながら下っていくデッキ構築ローグライク。1回の挑戦は30分ほどで、毎回違うカードと敵に出会う。'),
      features(id, 900030, ['挑戦ごとに迷宮の構成とカードの報酬が変わる', '折り紙のような敵と仕掛けが登場する', '1回の挑戦がおよそ30分で終わる']),
      ...tags(id, 900030, ['roguelike', 'deck-building', 'difficult']),
      steamLink(id, 900030),
    ],
  },
  {
    // 統合済み（転送ページの確認用）
    id: 'g_000007',
    status: 'merged',
    display: 'Stardust Atelier',
    original: 'Stardust Atelier',
    lang: 'en',
    devs: ['dev_000004'],
    mergedInto: 'g_000004',
    claims: () => [],
  },
  {
    id: 'g_000008',
    status: 'published',
    display: 'Moss Garden',
    original: 'Moss Garden',
    lang: 'en',
    steam: 900040,
    devs: ['dev_000006'],
    addedAt: '2026-10-26',
    claims: (id) => [
      released(id, 900040, 'pc', 2026, 8, 1, 'early-access'),
      ja(id, 900040, 'yes'),
      summary(id, 900040, '苔と小石を並べて、自分だけの小さな庭を育てる箱庭ゲーム。水やりや日当たりの調整で苔の色が変わり、季節ごとに庭の表情が移ろう。'),
      ...tags(id, 900040, ['cozy', 'nature']),
      steamLink(id, 900040),
    ],
  },
];

const claimsByGame = new Map<string, Claim[]>();
for (const g of games) {
  const claims = g.claims(g.id);
  claimsByGame.set(g.id, claims);
  const publisherIds = g.devs;
  const identityEvidence: Game['identityEvidence'] = [];
  if (g.steam) identityEvidence.push({ field: 'externalIds', evidence: steamEv(g.steam, 'steam:appdetails.steam_appid') });
  if (g.official) {
    identityEvidence.push({
      field: 'officialUrl',
      evidence: officialEv(g.official, `${g.original} official website`, '2026-10-01', '2026-10-20T00:20:11Z'),
    });
  }
  const selfPublished = g.steam
    ? steamEv(g.steam, 'steam:appdetails.developers,publishers')
    : officialEv(g.official ?? 'https://example.com/', `${g.original} is self-published`, '2026-10-01', '2026-10-20T00:20:11Z');
  const game: Game = {
    schemaVersion: 1,
    id: g.id,
    status: g.status,
    ...(g.mergedInto ? { mergedInto: g.mergedInto } : {}),
    title: { display: g.display, original: g.original, originalLang: g.lang },
    aliases: g.aliases ?? [],
    externalIds: g.steam ? { steamAppId: g.steam } : {},
    associatedApps: g.associatedApps ?? [],
    ...(g.official ? { officialUrl: g.official } : {}),
    developerIds: g.devs,
    publisherIds,
    indie: {
      assessment: 'indie',
      reasons: [{ code: 'self-published', evidence: [selfPublished] }],
      assessedAt: AT,
    },
    identityEvidence: g.status === 'merged' ? [] : identityEvidence,
    ...(g.disambiguation ? { disambiguation: g.disambiguation } : {}),
    createdAt: '2026-10-20T00:25:00Z',
    ...(g.addedAt ? { addedAt: g.addedAt } : {}),
    updatedAt: AT,
    createdByRun: RUN,
  };
  writeJson(Game, out(`data/games/${g.id}.json`), sortGame(game));
  if (claims.length > 0) {
    const file: ClaimsFile = { schemaVersion: 1, gameId: g.id, claims };
    writeJson(ClaimsFileSchema, out(`data/claims/${g.id}.json`), sortClaimsFile(file));
  }
}

// 記事
const articles: Article[] = [
  {
    schemaVersion: 1,
    id: articleId('https://news.example.jp/articles/2026/10/25/lantern-tide-delay'),
    url: 'https://news.example.jp/articles/2026/10/25/lantern-tide-delay?utm_source=rss',
    canonicalUrl: 'https://news.example.jp/articles/2026/10/25/lantern-tide-delay',
    urlAliases: ['https://news.example.jp/articles/2026/10/25/lantern-tide-delay?utm_source=rss'],
    sourceId: 'example-news-jp',
    outlet: { name: 'Example News', domain: 'news.example.jp' },
    title: '海洋探索ADV『Lantern Tide』PC版の発売が2027年春に延期',
    lang: 'ja',
    kind: 'news',
    publishedAt: '2026-10-25T03:00:00Z',
    retrievedAt: '2026-10-27T00:21:40Z',
    summaryJa: 'PC版の発売時期を2026年冬から2027年春へ変更したことを伝えるニュース。',
    games: [{ gameId: 'g_000001', role: 'primary' }],
    status: 'active',
    createdAt: AT,
    updatedAt: AT,
    createdByRun: RUN,
  },
  {
    schemaVersion: 1,
    id: articleId('https://indie.example.com/2026/10/five-quiet-games'),
    url: 'https://indie.example.com/2026/10/five-quiet-games',
    canonicalUrl: 'https://indie.example.com/2026/10/five-quiet-games',
    urlAliases: [],
    outlet: { name: 'Indie Example', domain: 'indie.example.com' },
    title: 'Five quiet games to play this autumn',
    lang: 'en',
    kind: 'roundup',
    publishedAt: '2026-10-10T12:00:00Z',
    retrievedAt: '2026-10-27T00:21:40Z',
    games: [
      { gameId: 'g_000001', role: 'roundup' },
      { gameId: 'g_000004', role: 'roundup' },
      { gameId: 'g_000008', role: 'roundup' },
    ],
    status: 'active',
    createdAt: AT,
    updatedAt: AT,
    createdByRun: RUN,
  },
  {
    schemaVersion: 1,
    id: articleId('https://news.example.jp/interviews/stardust-atelier'),
    url: 'https://news.example.jp/interviews/stardust-atelier',
    canonicalUrl: 'https://news.example.jp/interviews/stardust-atelier',
    urlAliases: [],
    sourceId: 'example-news-jp',
    outlet: { name: 'Example News', domain: 'news.example.jp' },
    title: '『星屑のアトリエ』開発者インタビュー。工房づくりと、影響を受けた作品',
    lang: 'ja',
    kind: 'interview',
    publishedAt: '2026-04-01T09:00:00Z',
    retrievedAt: '2026-10-27T00:21:40Z',
    games: [
      { gameId: 'g_000004', role: 'primary' },
      { gameId: 'g_000006', role: 'mention' },
    ],
    status: 'active',
    createdAt: AT,
    updatedAt: AT,
    createdByRun: RUN,
  },
];
for (const a of articles) writeJson(Article, out(`data/articles/${a.id}.json`), sortArticle(a));

// コレクション
const claimOf = (gameId: string, field: string) => claimsByGame.get(gameId)!.find((c) => c.field === field && c.status === 'adopted')!.id;
const jaItems = ['g_000001', 'g_000004', 'g_000006', 'g_000008'].map((gameId, position) => ({
  gameId,
  reason: '日本語の表示に対応していることを、ストアか公式サイトで確認できた作品。',
  evidenceClaimIds: [claimOf(gameId, 'japaneseSupport')],
  addedAt: '2026-10-27',
  addedBy: by,
  position,
}));
writeJson(Collection, out('data/collections/col_0001.json'), sortCollection({
  schemaVersion: 1,
  id: 'col_0001',
  status: 'published',
  title: '日本語で遊べる作品',
  lede: '日本語の表示に対応していることを確認できた作品を集めた。',
  description: 'ストアや公式サイトで、**日本語の表示**に対応していると確認できた作品。',
  criteria: { text: '日本語の表示（インターフェース）に対応していると、出典で確認できること。', rules: { japaneseInterface: ['yes'] } },
  items: jaItems,
  order: 'curated',
  featured: true,
  createdBy: by,
  createdAt: AT,
  updatedAt: AT,
}));
writeJson(Collection, out('data/collections/col_0002.json'), sortCollection({
  schemaVersion: 1,
  id: 'col_0002',
  status: 'draft',
  title: 'ローグライクの入口',
  lede: '短い挑戦を繰り返して上達していく作品。',
  description: '',
  criteria: { text: 'ローグライクのタグが付いていること。', rules: { anyTags: ['roguelike'] } },
  items: ['g_000003', 'g_000006'].map((gameId, position) => ({
    gameId,
    reason: '挑戦ごとに構成が変わり、繰り返して上達していくローグライク。',
    evidenceClaimIds: [],
    addedAt: '2026-10-27',
    addedBy: by,
    position,
  })),
  order: 'curated',
  featured: false,
  createdBy: by,
  createdAt: AT,
  updatedAt: AT,
}));

// 知名度（架空の数）。g_000001 は殿堂入り、g_000002 は人気
writeJson(PopularityMetrics, out('data/metrics/popularity.json'), {
  schemaVersion: 1,
  entries: {
    g_000001: {
      steamReviews: 180000,
      steamScore: { positive: 171000, total: 180000, desc: 'Overwhelmingly Positive' },
      retrievedAt: AT,
    },
    g_000002: { steamReviews: 42000, retrievedAt: AT },
  },
});

// 作品間の関係
writeJson(GameRelationsFile, out('data/relations/game-relations.json'), sortRelations({
  schemaVersion: 1,
  relations: [
    {
      id: relationId('g_000001', 'g_000005', 'same-series'),
      a: 'g_000001',
      b: 'g_000005',
      kind: 'same-series',
      reason: '同じ開発者による『Lantern Tide』シリーズの作品。',
      basis: 'fact',
      evidenceClaimIds: [],
      evidence: [steamEv(900004, 'steam:appdetails.name')],
      status: 'adopted',
      createdBy: by,
      createdAt: AT,
      updatedAt: AT,
      createdByRun: RUN,
    },
    {
      id: relationId('g_000003', 'g_000006', 'similar-play'),
      a: 'g_000003',
      b: 'g_000006',
      kind: 'similar-play',
      reason: 'どちらも挑戦のたびに構成が変わり、繰り返して深い階層を目指すローグライク。',
      basis: 'editorial',
      evidenceClaimIds: [claimOf('g_000003', 'tag'), claimOf('g_000006', 'tag')],
      evidence: [],
      status: 'adopted',
      createdBy: by,
      createdAt: AT,
      updatedAt: AT,
      createdByRun: RUN,
    },
  ],
}));

// 運用の状態
writeJson(TasksFile, out('state/tasks.json'), sortTasks({
  schemaVersion: 1,
  tasks: [
    {
      id: taskId('fill-missing', 'g_000002|japaneseSupport'),
      type: 'fill-missing',
      target: { gameId: 'g_000002', field: 'japaneseSupport' },
      goal: '『Echoes』（Quiet Bell Studio）の日本語対応を確かめる',
      status: 'open',
      priority: 40,
      attempts: 0,
      createdAt: AT,
      createdBy: 'scheduler',
    },
  ],
}));
writeJson(ReviewQueue, out('state/review-queue.json'), { schemaVersion: 1, items: [] });
const a1 = articles[0]!;
writeJson(SeenUrls, out('state/seen-urls.json'), {
  schemaVersion: 1,
  entries: {
    [urlKey(a1.canonicalUrl)]: {
      status: 'article',
      articleId: a1.id,
      sourceId: 'example-news-jp',
      attempts: 1,
      firstSeenAt: '2026-10-27',
      lastSeenAt: '2026-10-27',
    },
  },
});

console.log(`wrote ${ROOT}`);

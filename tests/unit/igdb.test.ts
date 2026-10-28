import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadRepo } from '../../scripts/lib/repo-io.ts';
import { applyIgdb } from '../../scripts/pipeline/igdb-sync.ts';
import { igdbDate, igdbReleases, igdbStoreLinks, isSameWorkName, mapPlatform, mapRegion, type IgdbGame } from '../../scripts/sources/igdb.ts';

const utc = (s: string) => Date.parse(`${s}T00:00:00Z`) / 1000;

// 架空の作品（10 §10.5.1）
const ig: IgdbGame = {
  id: 9000001,
  name: 'Lantern Tide',
  slug: 'lantern-tide',
  release_dates: [
    {
      date: utc('2025-04-02'),
      date_format: 0,
      release_region: 8,
      platform: { id: 6, slug: 'win' },
      human: 'Apr 02, 2025',
    },
    {
      date: utc('2026-03-05'),
      date_format: 0,
      release_region: 8,
      platform: { id: 130, slug: 'switch' },
      human: 'Mar 05, 2026',
    },
    { date: utc('2026-03-04'), date_format: 0, release_region: 5, platform: { id: 130, slug: 'switch' } },
    { date: utc('2027-01-01'), date_format: 2, release_region: 8, platform: { id: 167, slug: 'ps5' }, human: '2027' },
    { date_format: 7, release_region: 8, platform: { id: 169, slug: 'series-x-s' }, human: 'TBD' },
    { date: utc('2016-01-01'), date_format: 0, release_region: 8, platform: { id: 41, slug: 'wiiu' } },
  ],
  screenshots: [{ image_id: 'sc0001' }, { image_id: 'sc0002' }],
  websites: [
    { url: 'https://lantern-tide.example/' },
    { url: 'https://store.steampowered.com/app/9000001' },
    { url: 'https://store.playstation.com/en-us/concept/900001' },
    { url: 'https://itunes.apple.com/us/app/lantern-tide/id900001' },
  ],
  external_games: [
    { url: 'https://www.gog.com/en/game/lantern_tide' },
    { url: 'https://www.xbox.com/en-us/games/store/lantern-tide/9NLANTERN0001' },
    { url: 'https://www.microsoft.com/en-us/p/-1-/9NLANTERN0001' },
    { url: 'https://store.playstation.com/en-gb/concept/900001' },
    { url: 'https://amazon.de/dp/B000000000' },
    {},
  ],
};

describe('IGDB の変換', () => {
  it('機種と地域', () => {
    expect(mapPlatform('win')).toBe('pc');
    expect(mapPlatform('ps4--1')).toBe('ps4');
    expect(mapPlatform('switch-2')).toBe('switch2');
    expect(mapPlatform('wiiu')).toBeUndefined();
    expect(mapRegion(8)).toBe('global');
    expect(mapRegion(5)).toBe('jp');
    expect(mapRegion(3)).toBe('other');
  });

  it('日付の精度', () => {
    expect(igdbDate({ date: utc('2026-03-05'), date_format: 0 })).toEqual({
      precision: 'day',
      year: 2026,
      month: 3,
      day: 5,
    });
    expect(igdbDate({ date: utc('2026-03-01'), date_format: 1 })).toEqual({ precision: 'month', year: 2026, month: 3 });
    expect(igdbDate({ date: utc('2027-04-01'), date_format: 4 })).toEqual({
      precision: 'quarter',
      year: 2027,
      quarter: 2,
    });
    expect(igdbDate({ date: utc('2027-12-31'), date_format: 7 })).toBeUndefined();
  });

  it('機種ごとに1件。全世界の発売日を優先し、状況を日付から決める', () => {
    const r = igdbReleases(ig, '2026-10-28');
    expect(r.map((x) => `${x.platform}:${x.region}:${x.status}`).sort()).toEqual([
      'pc:global:released',
      'ps5:global:upcoming',
      'switch:global:released',
      'xbox-series:global:tba',
    ]);
  });

  it('家庭用ゲーム機版の別登録を、単語の切れ目で一致する名前として見つける', () => {
    expect(isSameWorkName('Lantern Tide Console Edition', 'Lantern Tide')).toBe(true);
    expect(isSameWorkName('Lantern Tide: Deluxe', 'Lantern Tide')).toBe(true);
    expect(isSameWorkName('Lantern Tides', 'Lantern Tide')).toBe(false);
    expect(isSameWorkName('lantern tide', 'Lantern Tide')).toBe(true);
  });

  it('ストアのリンクは Steam 以外を1ストア1件、日本向けの URL にする', () => {
    expect(igdbStoreLinks(ig)).toEqual([
      { store: 'playstation-store', url: 'https://store.playstation.com/ja-jp/concept/900001' },
      { store: 'app-store', url: 'https://apps.apple.com/jp/app/lantern-tide/id900001' },
      { store: 'gog', url: 'https://www.gog.com/game/lantern_tide' },
      { store: 'microsoft-store', url: 'https://www.xbox.com/ja-JP/games/store/lantern-tide/9NLANTERN0001' },
    ]);
  });
});

describe('IGDB での補完', () => {
  beforeAll(() => {
    process.env.INDIEATLAS_ROOT = path.resolve('tests/fixtures/repo');
  });
  afterAll(() => {
    delete process.env.INDIEATLAS_ROOT;
  });

  const opts = { at: '2026-10-28T00:00:00Z', today: '2026-10-28', createdBy: 'agent' as const, runId: 'local-test' };

  it('ストアの根拠がある機種は上書きせず、他の機種とスクリーンショットを加える', () => {
    const repo = loadRepo();
    const g = repo.games.find((x) => x.id === 'g_000001')!;
    const r = applyIgdb(g, repo.claims.get(g.id), ig, opts);
    expect(r.game.externalIds.igdbId).toBe(9000001);
    // g_000001 は pc と switch に採用済みの発売情報がある
    expect(r.added.releases.sort()).toEqual(['ps5:upcoming', 'xbox-series:tba']);
    expect(r.added.screenshots).toBe(2);
    const shots = r.claims.claims.filter((c) => c.field === 'image' && c.value.role === 'screenshot');
    expect(shots[0]!.evidence[0]!.kind).toBe('database');
    expect(r.added.stores).toEqual(['playstation-store', 'app-store', 'gog', 'microsoft-store']);
  });

  it('2回適用しても増えない', () => {
    const repo = loadRepo();
    const g = repo.games.find((x) => x.id === 'g_000001')!;
    const first = applyIgdb(g, repo.claims.get(g.id), ig, opts);
    const second = applyIgdb(first.game, first.claims, ig, opts);
    expect(second.added).toEqual({ releases: [], screenshots: 0, stores: [] });
    expect(second.claims.claims.length).toBe(first.claims.claims.length);
  });
});

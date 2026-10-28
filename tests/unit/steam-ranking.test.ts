import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { siteRanking } from '../../scripts/build/prepare-site.ts';
import { loadRepo } from '../../scripts/lib/repo-io.ts';
import { parseTopSellers } from '../../scripts/sources/steam.ts';

describe('Steam のインディーの売上上位', () => {
  beforeAll(() => {
    process.env.INDIEATLAS_ROOT = path.resolve('tests/fixtures/repo');
  });
  afterAll(() => {
    delete process.env.INDIEATLAS_ROOT;
  });

  it('検索結果の JSON から ID、名前、横長の画像を読む', () => {
    const text = JSON.stringify({
      items: [
        { name: 'Lantern Tide', logo: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/9000001/abc/capsule_sm_120.jpg?t=1' },
        { name: '名前だけ' },
      ],
    });
    expect(parseTopSellers(text)).toEqual([
      {
        appId: 9000001,
        title: 'Lantern Tide',
        image: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/9000001/abc/capsule_231x87.jpg?t=1',
      },
    ]);
    expect(parseTopSellers('<html>')).toBeUndefined();
  });

  it('Amazon の売れ筋がなければ、Steam の売上上位を Amazon の検索へのアソシエイトのリンクで出す', () => {
    const repo = loadRepo();
    const appId = repo.games.find((g) => g.id === 'g_000001')!.externalIds.steamAppId!;
    const r = siteRanking(repo, undefined, {
      schemaVersion: 1,
      fetchedAt: '2026-10-28T00:00:00Z',
      items: [
        { appId, title: 'Lantern Tide' },
        { appId: 1, title: '霧の灯台' },
      ],
    });
    expect(r.source).toBe('steam');
    expect(r.items[0]!.gameId).toBe('g_000001');
    expect(r.items[1]!.gameId).toBeUndefined();
    const u = new URL(r.items[1]!.url);
    expect(u.hostname).toBe('www.amazon.co.jp');
    expect(u.searchParams.get('tag')).toBe('pspken-22');
    expect(u.searchParams.get('k')).toBe('霧の灯台');
  });
});

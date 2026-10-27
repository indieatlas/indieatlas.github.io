import { describe, expect, it } from 'vitest';
import type { FetchResult, HttpClient } from '../../scripts/fetch/http.ts';
import { createCreatorsClient, isFresh, rankingFromItems, type CreatorsItem } from '../../scripts/sources/amazon.ts';

// 架空の商品（10 §10.5.1）
const item = (asin: string, title: string, rank?: number, group = 'Video Games'): CreatorsItem => ({
  asin,
  detailPageURL: `https://www.amazon.co.jp/dp/${asin}?tag=test-22`,
  itemInfo: { title: { displayValue: title }, classifications: { productGroup: { displayValue: group } } },
  images: { primary: { large: { url: `https://m.media-amazon.com/images/I/${asin}.jpg`, width: 500, height: 500 } } },
  ...(rank ? { browseNodeInfo: { websiteSalesRank: { salesRank: rank } } } : {}),
});

describe('Amazon の売れ筋', () => {
  it('売れ筋の順に並べ、プリペイドや周辺機器、順位のない商品、重複を除く', () => {
    const r = rankingFromItems(
      [
        item('B000000003', 'ランタンの森 - Switch 2', 30),
        item('B000000001', 'ニンテンドープリペイド番号 3000円', 1),
        item('B000000002', '星屑のアトリエ - PS5', 12),
        item('B000000004', 'Joy-Con 充電スタンド', 5, 'Video Game Accessories'),
        item('B000000005', '霧の灯台 - Switch'),
        item('B000000002', '星屑のアトリエ - PS5', 12),
        item('B000000006', 'ゲーム機本体 セット', 2, 'Video Game Hardware'),
      ],
      '2026-10-28T00:00:00Z',
    );
    expect(r.items.map((i) => [i.asin, i.platform])).toEqual([
      ['B000000002', 'PS5'],
      ['B000000003', 'Nintendo Switch 2'],
    ]);
  });

  it('取得から24時間を過ぎたら使わない', () => {
    const r = { schemaVersion: 1 as const, fetchedAt: '2026-10-28T00:00:00Z', items: [] };
    expect(isFresh(r, new Date('2026-10-28T23:59:00Z'))).toBe(true);
    expect(isFresh(r, new Date('2026-10-29T00:00:01Z'))).toBe(false);
  });

  it('極東の資格情報は日本の窓口でトークンを得て、Bearer と x-marketplace を付けて呼ぶ', async () => {
    const calls: { url: string; body: string; headers?: Record<string, string> }[] = [];
    const ok = (text: string): FetchResult => ({
      url: '',
      status: 200,
      contentType: 'application/json',
      text,
      bytes: new Uint8Array(),
      fetchHash: 'sha256:' + '0'.repeat(64),
      retrievedAt: new Date('2026-10-28T00:00:00Z'),
    });
    const http: HttpClient = {
      get: async () => ok(''),
      post: async (url, body, init) => {
        calls.push({ url, body, headers: init?.headers });
        return ok(url.includes('/auth/o2/token') ? '{"access_token":"tok"}' : '{"searchResult":{"items":[]}}');
      },
    };
    const client = await createCreatorsClient(http, { credentialId: 'id', credentialSecret: 'secret', version: '3.3' });
    await client.call('searchItems', { keywords: 'x' });
    expect(calls[0]!.url).toBe('https://api.amazon.co.jp/auth/o2/token');
    expect(JSON.parse(calls[0]!.body).scope).toBe('creatorsapi::default');
    expect(calls[1]!.url).toBe('https://creatorsapi.amazon/catalog/v1/searchItems');
    expect(calls[1]!.headers).toMatchObject({ Authorization: 'Bearer tok', 'x-marketplace': 'www.amazon.co.jp' });
    expect(JSON.parse(calls[1]!.body).marketplace).toBe('www.amazon.co.jp');
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SourceState } from '../../schema/state.ts';
import { createFetcher } from '../../scripts/fetch/fetcher.ts';
import { loadRepo } from '../../scripts/lib/repo-io.ts';
import { collect } from '../../scripts/pipeline/collect.ts';
import { fakeTransport, type FakeRoute } from '../helpers/fake-web.ts';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-collect-'));
  fs.cpSync(path.resolve('tests/fixtures/repo'), dir, { recursive: true });
  process.env.INDIEATLAS_ROOT = dir;
  process.env.INDIEATLAS_NOW = '2026-10-27T00:20:00Z';
});
afterEach(() => {
  delete process.env.INDIEATLAS_ROOT;
  delete process.env.INDIEATLAS_NOW;
  fs.rmSync(dir, { recursive: true, force: true });
});

const FEED = 'https://news.example.jp/feed/indie.xml';
const now = new Date('2026-10-27T00:20:00Z');
const fetcherFor = (routes: Record<string, FakeRoute>) =>
  createFetcher(fakeTransport(routes), {
    userAgent: 'IndieAtlasBot/0.1',
    timeoutMs: 1000,
    maxBytes: 2_000_000,
    minIntervalMs: 0,
  });

describe('collect（06 §6.3）', () => {
  it('フィードの新着を古い順に取り、除外のカテゴリを外し、処理位置を進める', async () => {
    const r = await collect(loadRepo(), fetcherFor({ [FEED]: { file: 'news/feed.xml' } }), new Map(), now);
    expect(r.items.map((i) => i.title)).toEqual([
      '潮の群島を探索する『Lantern Tide』先行プレイ',
      '灯台を直す新作『Tidewright』が Steam で発売',
      '『Moss Garden』に新しい季節が加わるアップデート',
      '新しいグラフィックボードが発表',
    ]);
    const u = r.updates[0]!;
    expect(u.ok).toBe(true);
    expect(u.state.cursor.recentItemKeys).toHaveLength(4);
    expect(u.state.lastSuccessAt).toBe('2026-10-27T00:20:00Z');
  });

  it('処理位置にある項目は取り直さない', async () => {
    const first = await collect(loadRepo(), fetcherFor({ [FEED]: { file: 'news/feed.xml' } }), new Map(), now);
    const states = new Map<string, SourceState>([['example-news-jp', first.updates[0]!.state]]);
    const again = await collect(
      loadRepo(),
      fetcherFor({ [FEED]: { file: 'news/feed.xml' } }),
      states,
      new Date('2026-10-27T12:00:00Z'),
    );
    expect(again.items).toEqual([]);
  });

  it('14日より古い項目は取らない', async () => {
    const r = await collect(
      loadRepo(),
      fetcherFor({ [FEED]: { file: 'news/feed.xml' } }),
      new Map(),
      new Date('2026-11-20T00:00:00Z'),
    );
    expect(r.items).toEqual([]);
  });

  it('失敗したら処理位置を進めず、2回目からは間隔をあける（07 §7.7）', async () => {
    const prev: SourceState = {
      schemaVersion: 1,
      sourceId: 'example-news-jp',
      cursor: { recentItemKeys: ['k1'] },
      consecutiveFailures: 2,
    };
    const r = await collect(
      loadRepo(),
      fetcherFor({ [FEED]: { status: 503 } }),
      new Map([['example-news-jp', prev]]),
      now,
    );
    const u = r.updates[0]!;
    expect(u.ok).toBe(false);
    expect(u.state.cursor.recentItemKeys).toEqual(['k1']);
    expect(u.state.consecutiveFailures).toBe(3);
    expect(u.state.nextAttemptAfter).toBe('2026-10-29T00:20:00Z'); // 2^(3-2) = 2日後
  });

  it('nextAttemptAfter が未来の情報源は取得しない', async () => {
    const prev: SourceState = {
      schemaVersion: 1,
      sourceId: 'example-news-jp',
      cursor: { recentItemKeys: [] },
      consecutiveFailures: 3,
      nextAttemptAfter: '2026-10-28T00:00:00Z',
    };
    const r = await collect(loadRepo(), fetcherFor({}), new Map([['example-news-jp', prev]]), now);
    expect(r.updates).toEqual([]);
  });
});

import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IndieEvent } from '../../schema/event.ts';
import { loadRepo, type RepoData } from '../../scripts/lib/repo-io.ts';
import { lookupUrls, refreshStatus } from '../../scripts/pipeline/refresh-status.ts';

let repo: RepoData;

beforeAll(() => {
  process.env.INDIEATLAS_ROOT = path.resolve('tests/fixtures/repo');
  repo = loadRepo();
});

afterAll(() => {
  delete process.env.INDIEATLAS_ROOT;
});

function event(id: string, name: string, start: string, extra: Partial<IndieEvent> = {}): IndieEvent {
  const [year, month, day] = start.split('-').map(Number) as [number, number, number];
  return {
    schemaVersion: 1,
    id,
    status: 'scheduled',
    name,
    kind: 'exhibition',
    format: 'in-person',
    start: { precision: 'day', year, month, day },
    url: 'https://example.com/event/',
    summary: '架空のインディーゲームの展示会。確かめ直す対象を調べるための例。',
    games: [],
    evidence: [{ kind: 'official', url: 'https://example.com/event/', retrievedAt: '2026-01-01T00:00:00Z' }],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    createdBy: 'agent',
    createdByRun: 'local-test',
    ...extra,
  } as IndieEvent;
}

describe('refresh:status（12 §12.6.7）', () => {
  it('発売予定と早期アクセスの作品を、予定日を過ぎたものから並べる', () => {
    // g_000001 は 2027年春（PC）と 2027年（Switch）の予定、g_000005 は未定、g_000008 は早期アクセス
    const s = refreshStatus(repo, '2027-07-01');
    expect(s.releases.map((r) => [r.gameId, r.reason])).toEqual([
      ['g_000001', 'date-passed'],
      ['g_000005', 'upcoming'],
      ['g_000008', 'early-access'],
    ]);
    expect(s.releases[0]!.steamAppId).toBe(900001);
    expect(s.releases[0]!.releases[0]).toEqual({ platform: 'pc', status: 'upcoming', date: '2027-03-01..2027-05-31' });

    const before = refreshStatus(repo, '2026-11-03');
    expect(before.releases.find((r) => r.gameId === 'g_000001')!.reason).toBe('upcoming');
  });

  it('統合済みの作品は数えず、公開中の作品で値のないものを挙げる', () => {
    const s = refreshStatus(repo, '2026-11-03');
    expect(s.releases.some((r) => r.gameId === 'g_000007')).toBe(false);
    const published = repo.games.filter((g) => g.status === 'published' && g.externalIds.steamAppId).map((g) => g.id);
    expect(s.metrics.popularity.missing).toEqual(published.filter((id) => !repo.popularity.entries[id]).sort());
    expect(s.metrics.popularity.entries).toBe(Object.keys(repo.popularity.entries).length);
    for (const id of s.gamesWithoutCollection) expect(repo.games.find((g) => g.id === id)!.status).toBe('published');
  });

  it('近づいた催し、確かめ直す日を過ぎた催し、次の回のない終わった催しを挙げる', () => {
    const r: RepoData = {
      ...repo,
      events: [
        event('ev_0000000000000001', '架空ゲーム展 2026', '2026-11-20'),
        event('ev_0000000000000002', '架空ゲーム展 2025', '2025-11-20'),
        event('ev_0000000000000003', '架空ジャム 2026', '2026-06-01'),
        event('ev_0000000000000004', '架空ショーケース', '2027-03-01', { recheckAfter: '2026-11-01' }),
        event('ev_0000000000000005', '中止の催し', '2026-11-10', { status: 'cancelled' }),
      ],
    };
    const s = refreshStatus(r, '2026-11-03');
    expect(s.events.map((e) => [e.eventId, e.reasons])).toEqual([
      ['ev_0000000000000003', ['ended-no-next']],
      ['ev_0000000000000001', ['soon']],
      ['ev_0000000000000004', ['recheck-due']],
    ]);
  });

  it('記事の URL が登録済みかを、canonical と別名でも調べる', () => {
    const a = repo.articles[0]!;
    const [known, unknown] = lookupUrls(repo, [a.canonicalUrl, 'https://example.com/not-registered']);
    expect(known!.articleId).toBe(a.id);
    expect(unknown!.articleId).toBeUndefined();
  });
});

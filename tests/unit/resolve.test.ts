import { describe, expect, it } from 'vitest';
import type { Claim, Evidence } from '../../schema/claim.ts';
import { makeClaim } from '../../scripts/lib/claim-builder.ts';
import { independentCount, resolveGameClaims } from '../../scripts/pipeline/resolve.ts';

const at = '2026-10-27T00:00:00Z';
const ev = (kind: Evidence['kind'], url: string, originKey: string, retrievedAt = at): Evidence => ({
  kind,
  url,
  retrievedAt,
  quote: '根拠の文がここにある',
  originKey,
});

function release(
  value: Claim['value'],
  evidence: Evidence[],
  asOf: string,
  status: Claim['status'] = 'candidate',
  platform = 'pc',
) {
  return makeClaim({
    gameId: 'g_000001',
    field: 'release',
    scope: { platform: platform as 'pc', region: 'global' },
    value: value as never,
    evidence,
    asOf,
    status,
    at: `${asOf}T00:00:00Z`,
    createdBy: 'llm',
    createdByRun: 'local-test',
  });
}

function ja(
  value: { interface: 'yes' | 'no'; subtitles: 'yes' | 'no'; audio: 'no' },
  evidence: Evidence[],
  asOf: string,
  status: Claim['status'] = 'candidate',
) {
  return makeClaim({
    gameId: 'g_000001',
    field: 'japaneseSupport',
    value,
    evidence,
    asOf,
    status,
    at: `${asOf}T00:00:00Z`,
    createdBy: 'llm',
    createdByRun: 'local-test',
  });
}

const resolve = (claims: Claim[], newIds: string[] = []) =>
  resolveGameClaims(claims, { at, tags: [], newIds: new Set(newIds) });

describe('Claim の採用（06 §6.8、受入基準5）', () => {
  it('F07: 公式の延期の告知は、前の予定を置き換える', () => {
    const old = release(
      { status: 'upcoming', date: { precision: 'season', year: 2026, season: 'winter' } },
      [ev('official', 'https://lanterntide.example.com/', 'official:example.com')],
      '2026-06-10',
      'adopted',
    );
    const next = release(
      { status: 'upcoming', date: { precision: 'season', year: 2027, season: 'spring' } },
      [ev('official', 'https://lanterntide.example.com/news', 'official:example.com')],
      '2026-10-24',
    );
    next.supersedes = [old.id];
    const r = resolve([old, next]);
    expect(old.status).toBe('superseded');
    expect(old.supersededBy).toBe(next.id);
    expect(next.status).toBe('adopted');
    expect(r.conflicts).toEqual([]);
  });

  it('F10: ストアの「日本語非対応」は、より新しい媒体の「対応」で上書きされない', () => {
    const store = ja(
      { interface: 'no', subtitles: 'no', audio: 'no' },
      [ev('store', 'https://store.steampowered.com/app/900001/', 'store:steam')],
      '2026-10-01',
      'adopted',
    );
    const media = ja(
      { interface: 'yes', subtitles: 'yes', audio: 'no' },
      [ev('media', 'https://news.example.jp/a/1', 'media:example.jp')],
      '2026-10-20',
    );
    const r = resolve([store, media]);
    expect(store.status).toBe('adopted');
    expect(media.status).toBe('conflicted');
    expect(r.conflicts).toHaveLength(1);
  });

  it('F09: 同じプレスリリースの転載3件は、独立した裏づけ1件として数える', () => {
    const pr = 'pr:https://press.example.com/lantern-tide';
    const claim = release(
      { status: 'upcoming', date: { precision: 'month', year: 2027, month: 3 } },
      [
        ev('media', 'https://a.example.jp/1', pr),
        ev('media', 'https://b.example.jp/1', pr),
        ev('media', 'https://c.example.jp/1', pr),
      ],
      '2026-10-20',
    );
    expect(independentCount(claim)).toBe(1);
    const current = release(
      { status: 'upcoming', date: { precision: 'year', year: 2027 } },
      [ev('media', 'https://d.example.jp/1', 'media:d.example.jp')],
      '2026-09-01',
      'adopted',
    );
    resolve([current, claim]);
    // 同じ順位で、独立した裏づけが2件に満たないので置き換えない
    expect(current.status).toBe('adopted');
    expect(claim.status).toBe('conflicted');
  });

  it('ストアのより新しい情報は、前のストアの情報を矛盾にせず置き換える', () => {
    const old = release(
      { status: 'upcoming', date: { precision: 'month', year: 2026, month: 11 } },
      [ev('store', 'https://store.steampowered.com/app/900001/', 'store:steam')],
      '2026-10-20',
      'adopted',
    );
    const next = release(
      { status: 'released', date: { precision: 'day', year: 2026, month: 11, day: 5 } },
      [ev('store', 'https://store.steampowered.com/app/900001/', 'store:steam')],
      '2026-11-06',
    );
    const r = resolve([old, next]);
    expect(next.status).toBe('adopted');
    expect(old.status).toBe('superseded');
    expect(r.conflicts).toEqual([]);
  });

  it('採用済みがなければ最上位を採用し、より低い順位の異なる値は候補にする', () => {
    const db = release(
      { status: 'upcoming', date: { precision: 'year', year: 2027 } },
      [ev('database', 'https://www.igdb.com/games/x', 'database:igdb.com')],
      '2026-10-01',
    );
    const store = release(
      { status: 'upcoming', date: { precision: 'season', year: 2027, season: 'spring' } },
      [ev('store', 'https://store.steampowered.com/app/900001/', 'store:steam')],
      '2026-09-01',
    );
    resolve([db, store]);
    expect(store.status).toBe('adopted');
    expect(db.status).toBe('conflicted'); // 採用より新しいが置き換えられない → 確認のタスク
  });

  it('同じ順位で14日以内の異なる値は、採用済みがなければ両方を conflicted にする', () => {
    const a = release(
      { status: 'upcoming', date: { precision: 'month', year: 2027, month: 3 } },
      [ev('media', 'https://a.example.jp/1', 'media:a.example.jp')],
      '2026-10-20',
    );
    const b = release(
      { status: 'upcoming', date: { precision: 'month', year: 2027, month: 5 } },
      [ev('media', 'https://b.example.jp/1', 'media:b.example.jp')],
      '2026-10-25',
    );
    const r = resolve([a, b]);
    expect(a.status).toBe('conflicted');
    expect(b.status).toBe('conflicted');
    expect(r.conflicts[0]!.claimIds.sort()).toEqual([a.id, b.id].sort());
  });

  it('タグは12件までを採用する', () => {
    const tags = Array.from({ length: 14 }, (_, i) =>
      makeClaim({
        gameId: 'g_000001',
        field: 'tag',
        value: { tagId: `t${String(i).padStart(2, '0')}` },
        evidence: [ev('store', 'https://store.steampowered.com/app/900001/', 'store:steam')],
        asOf: '2026-10-20',
        status: 'candidate',
        at: `2026-10-${String(10 + i).padStart(2, '0')}T00:00:00Z`,
        createdBy: 'llm',
        createdByRun: 'local-test',
      }),
    );
    resolveGameClaims(tags, {
      at,
      tags: tags.map((t) => ({
        id: (t.value as { tagId: string }).tagId,
        label: { ja: 'x', en: 'x' },
        aliases: [],
        group: 'genre',
        definition: '説明が10字以上ある',
        status: 'core',
        createdBy: 'human',
        createdAt: at,
      })),
      newIds: new Set(),
    });
    expect(tags.filter((t) => t.status === 'adopted')).toHaveLength(12);
    expect(tags.filter((t) => t.statusReason === 'tag-limit')).toHaveLength(2);
  });
});

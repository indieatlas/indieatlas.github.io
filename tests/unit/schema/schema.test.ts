import { describe, expect, it } from 'vitest';
import { Claim, Evidence } from '../../../schema/claim.ts';
import { PartialDate } from '../../../schema/common.ts';
import { Game } from '../../../schema/game.ts';

const evidence = {
  kind: 'store',
  url: 'https://store.steampowered.com/app/900001/',
  retrievedAt: '2026-10-20T00:20:11Z',
  locator: 'steam:appdetails.release_date.date',
  originKey: 'store:steam',
};

const game = {
  schemaVersion: 1,
  id: 'g_000001',
  status: 'candidate',
  title: { display: 'ランタンタイド', original: 'Lantern Tide', originalLang: 'en' },
  aliases: [],
  externalIds: { steamAppId: 900001 },
  associatedApps: [],
  developerIds: ['dev_000001'],
  publisherIds: ['dev_000001'],
  indie: { assessment: 'unknown', reasons: [], assessedAt: '2026-10-20T00:25:00Z' },
  identityEvidence: [],
  createdAt: '2026-10-20T00:25:00Z',
  updatedAt: '2026-10-20T00:25:00Z',
  createdByRun: 'local-seed',
};

describe('schema', () => {
  it('Evidence は quote、quoteHash、locator のいずれかを必要とする', () => {
    expect(Evidence.safeParse(evidence).success).toBe(true);
    const { locator: _, ...noLocator } = evidence;
    expect(Evidence.safeParse(noLocator).success).toBe(false);
  });

  it('PartialDate は暦にない日付を拒否する', () => {
    expect(PartialDate.safeParse({ precision: 'day', year: 2026, month: 2, day: 29 }).success).toBe(false);
    expect(PartialDate.safeParse({ precision: 'day', year: 2028, month: 2, day: 29 }).success).toBe(true);
  });

  it('published の作品には addedAt が必要', () => {
    expect(Game.safeParse(game).success).toBe(true);
    expect(Game.safeParse({ ...game, status: 'published' }).success).toBe(false);
    expect(Game.safeParse({ ...game, status: 'published', addedAt: '2026-10-20' }).success).toBe(true);
  });

  it('merged と mergedInto は対応する', () => {
    expect(Game.safeParse({ ...game, status: 'merged' }).success).toBe(false);
    expect(Game.safeParse({ ...game, mergedInto: 'g_000002' }).success).toBe(false);
    expect(Game.safeParse({ ...game, status: 'merged', mergedInto: 'g_000002' }).success).toBe(true);
  });

  it('Claim のキーの順番は ClaimBase の後に field と value', () => {
    const claim = Claim.parse({
      id: 'c_0000000000000001',
      gameId: 'g_000001',
      scope: { platform: 'pc' },
      basis: 'fact',
      evidence: [evidence],
      asOf: '2026-10-20',
      status: 'adopted',
      createdAt: '2026-10-20T00:25:00Z',
      updatedAt: '2026-10-20T00:25:00Z',
      lastCheckedAt: '2026-10-20T00:25:00Z',
      createdBy: 'human',
      createdByRun: 'local-seed',
      field: 'release',
      value: { status: 'released', date: { precision: 'day', year: 2026, month: 3, day: 5 } },
    });
    const keys = Object.keys(claim);
    expect(keys.slice(-2)).toEqual(['field', 'value']);
  });

  it('概要は60〜160字', () => {
    const base = {
      id: 'c_0000000000000002',
      gameId: 'g_000001',
      scope: {},
      basis: 'editorial',
      evidence: [evidence],
      asOf: '2026-10-20',
      status: 'adopted',
      createdAt: '2026-10-20T00:25:00Z',
      updatedAt: '2026-10-20T00:25:00Z',
      lastCheckedAt: '2026-10-20T00:25:00Z',
      createdBy: 'human',
      createdByRun: 'local-seed',
      field: 'summary',
    };
    expect(Claim.safeParse({ ...base, value: { ja: '短い' } }).success).toBe(false);
    expect(Claim.safeParse({ ...base, value: { ja: 'あ'.repeat(80) } }).success).toBe(true);
  });
});

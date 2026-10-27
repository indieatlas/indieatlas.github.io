import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadRepo } from '../../scripts/lib/repo-io.ts';
import { seedFromSteam } from '../../scripts/pipeline/seed-steam.ts';
import { parseSteamDate, releaseFrom } from '../../scripts/sources/steam.ts';
import { fakeHttp, steamRoutes } from '../helpers/fake-http.ts';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-seed-'));
  fs.cpSync(path.resolve('tests/fixtures/repo'), dir, { recursive: true });
  process.env.INDIEATLAS_ROOT = dir;
  process.env.INDIEATLAS_NOW = '2026-10-27T00:00:00Z';
});
afterEach(() => {
  delete process.env.INDIEATLAS_ROOT;
  delete process.env.INDIEATLAS_NOW;
  fs.rmSync(dir, { recursive: true, force: true });
});

const opts = { createdBy: 'human' as const, runId: 'local-seed' };

describe('seed:steam', () => {
  it('Steam の作品詳細から candidate の作品と Claim を作る', async () => {
    const http = fakeHttp(steamRoutes(900101));
    const r = await seedFromSteam(http, loadRepo(), 900101, opts);
    expect(r.created).toBe(true);
    expect(r.gameId).toBe('g_000009');
    const g = r.games[0]!;
    expect(g.status).toBe('candidate');
    expect(g.title).toEqual({ display: 'タイドライト', original: 'Tidewright', originalLang: 'en' });
    expect(g.aliases).toEqual([{ value: 'タイドライト', lang: 'ja', kind: 'localized' }]);
    expect(g.officialUrl).toBe('https://tidewright.example.com/');
    // 既存の開発者を名前で照合する
    expect(g.developerIds).toEqual(['dev_000001']);
    expect(g.indie.assessment).toBe('indie');
    expect(g.associatedApps.map((a) => `${a.kind}:${a.id}`)).toEqual(['demo:900102', 'dlc:900103']);

    const fields = r.claims!.claims.map((c) => `${c.field}:${c.scope.platform ?? ''}`).sort();
    expect(fields).toEqual(['image:', 'japaneseSupport:', 'playerModes:', 'release:mac', 'release:pc', 'storeLink:']);
    const ja = r.claims!.claims.find((c) => c.field === 'japaneseSupport')!;
    expect(ja.value).toEqual({ interface: 'yes', subtitles: 'yes', audio: 'no' });
    const modes = r.claims!.claims.find((c) => c.field === 'playerModes')!;
    expect(modes.value).toEqual({ modes: ['single', 'online-coop'] });
    const image = r.claims!.claims.find((c) => c.field === 'image')!;
    expect(image.value).toMatchObject({
      url: 'https://shared.example.com/steam/apps/900101/header.jpg',
      role: 'header',
    });
    expect(r.claims!.claims.every((c) => c.status === 'adopted' && c.createdBy === 'human')).toBe(true);
  });

  it('同じ作品を2回取り込んでも Claim は増えない', async () => {
    const http = fakeHttp(steamRoutes(900101));
    const first = await seedFromSteam(http, loadRepo(), 900101, opts);
    const repo = loadRepo();
    repo.games.push(first.games[0]!);
    repo.claims.set(first.gameId, first.claims!);
    const second = await seedFromSteam(http, repo, 900101, opts);
    expect(second.created).toBe(false);
    expect(second.gameId).toBe(first.gameId);
    expect(second.claimsAdded).toBe(0);
  });

  it('体験版は本編の associatedApps に加える', async () => {
    const http = fakeHttp(steamRoutes(900101, 900102));
    const first = await seedFromSteam(http, loadRepo(), 900101, opts);
    const repo = loadRepo();
    repo.games.push({ ...first.games[0]!, associatedApps: [] });
    const r = await seedFromSteam(http, repo, 900102, opts);
    expect(r.gameId).toBe(first.gameId);
    expect(r.games[0]!.associatedApps).toEqual([
      { store: 'steam', id: '900102', kind: 'demo', title: 'Tidewright Demo' },
    ]);
  });

  it('成人向けの性的な内容の記述子を持つ作品は登録しない（F14）', async () => {
    const http = fakeHttp(steamRoutes(900199));
    await expect(seedFromSteam(http, loadRepo(), 900199, opts)).rejects.toThrow(/成人向け/);
  });
});

describe('Steam の発売日の表記', () => {
  it.each([
    ['5 Mar, 2026', { precision: 'day', year: 2026, month: 3, day: 5 }],
    ['Mar 5, 2026', { precision: 'day', year: 2026, month: 3, day: 5 }],
    ['March 2026', { precision: 'month', year: 2026, month: 3 }],
    ['Q2 2027', { precision: 'quarter', year: 2027, quarter: 2 }],
    ['Spring 2027', { precision: 'season', year: 2027, season: 'spring' }],
    ['Fall 2027', { precision: 'season', year: 2027, season: 'autumn' }],
    ['2027', { precision: 'year', year: 2027 }],
  ])('%s', (text, expected) => {
    expect(parseSteamDate(text)).toEqual(expected);
  });

  it('読めない表記は undefined', () => {
    expect(parseSteamDate('Coming soon')).toBeUndefined();
    expect(parseSteamDate('To be announced')).toBeUndefined();
  });

  it('発売前で日付がなければ tba、早期アクセスのジャンルがあれば early-access', () => {
    expect(
      releaseFrom({
        type: 'game',
        name: 'x',
        steam_appid: 1,
        release_date: { coming_soon: true, date: 'To be announced' },
      }),
    ).toEqual({
      status: 'tba',
      rawText: 'To be announced',
    });
    expect(
      releaseFrom({
        type: 'game',
        name: 'x',
        steam_appid: 1,
        genres: [{ id: '70', description: 'Early Access' }],
        release_date: { coming_soon: false, date: '23 Oct, 2023' },
      }).status,
    ).toBe('early-access');
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adoptedOf } from '../../scripts/lib/claims-view.ts';
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

  it('ヘッダー画像が変わったら前の画像を置き換え、期間限定の差し替えは取り込まない', async () => {
    const first = await seedFromSteam(fakeHttp(steamRoutes(900101)), loadRepo(), 900101, opts);
    const repo = loadRepo();
    repo.games.push(first.games[0]!);
    repo.claims.set(first.gameId, first.claims!);
    // 作品詳細の JSON の header_image だけを差し替えた Fake
    const withHeader = (header: string) => {
      const routes = steamRoutes(900101);
      for (const [url, file] of Object.entries(routes)) {
        if (!file.includes('appdetails')) continue;
        const json = JSON.parse(fs.readFileSync(path.resolve('tests/fixtures/web', file), 'utf8'));
        json['900101'].data.header_image = header;
        const out = path.join(dir, path.basename(file));
        fs.writeFileSync(out, JSON.stringify(json));
        routes[url] = out;
      }
      return fakeHttp(routes);
    };
    const headers = (claims: typeof first.claims) => adoptedOf(claims!.claims, 'image').map((c) => c.value.url);

    const alt = await seedFromSteam(
      withHeader('https://shared.example.com/steam/apps/900101/abc/header_alt_assets_0.jpg?t=1'),
      repo,
      900101,
      opts,
    );
    expect(headers(alt.claims)).toEqual(['https://shared.example.com/steam/apps/900101/header.jpg']);
    expect(alt.notes.some((n) => n.includes('header_alt_assets'))).toBe(true);

    const updated = await seedFromSteam(
      withHeader('https://shared.example.com/steam/apps/900101/def/header.jpg?t=2'),
      repo,
      900101,
      opts,
    );
    expect(headers(updated.claims)).toEqual(['https://shared.example.com/steam/apps/900101/def/header.jpg']);
    const old = updated.claims!.claims.find((c) => c.field === 'image' && c.status === 'superseded')!;
    expect(old.value).toMatchObject({ url: 'https://shared.example.com/steam/apps/900101/header.jpg' });
  });

  it('新しい作品のヘッダー画像が期間限定の差し替えなら、差し替えの前の画像を使う', async () => {
    const routes = steamRoutes(900101);
    for (const [url, file] of Object.entries(routes)) {
      if (!file.includes('appdetails')) continue;
      const json = JSON.parse(fs.readFileSync(path.resolve('tests/fixtures/web', file), 'utf8'));
      json['900101'].data.header_image = 'https://shared.example.com/steam/apps/900101/abc/header_alt_assets_2.jpg?t=1';
      const out = path.join(dir, path.basename(file));
      fs.writeFileSync(out, JSON.stringify(json));
      routes[url] = out;
    }
    const r = await seedFromSteam(fakeHttp(routes), loadRepo(), 900101, opts);
    expect(adoptedOf(r.claims!.claims, 'image').map((c) => c.value.url)).toEqual([
      'https://shared.example.com/steam/apps/900101/header.jpg',
    ]);
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

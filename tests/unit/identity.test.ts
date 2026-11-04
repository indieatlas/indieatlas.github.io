import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadRepo, type RepoData } from '../../scripts/lib/repo-io.ts';
import { matchGame } from '../../scripts/pipeline/identity.ts';

let dir: string;
let repo: RepoData;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-identity-'));
  fs.cpSync(path.resolve('tests/fixtures/repo'), dir, { recursive: true });
  process.env.INDIEATLAS_ROOT = dir;
  repo = loadRepo();
});
afterAll(() => {
  delete process.env.INDIEATLAS_ROOT;
  fs.rmSync(dir, { recursive: true, force: true });
});

const match = (input: Parameters<typeof matchGame>[0]) =>
  matchGame(input, repo.games, repo.developers, (id) => repo.claims.get(id)?.claims);

describe('作品の同定（04 §4.3、受入基準3）', () => {
  it('F02: 同名でも Steam の ID が違えば別の作品になる', () => {
    const r = match({ titles: ['Echoes'], developerNames: ['Other Studio'], externalIds: { steamAppId: 900099 } });
    expect(r.kind).toBe('none');
    if (r.kind === 'none') expect(r.sameNameGameIds.sort()).toEqual(['g_000002', 'g_000003']);
  });

  it('F02: 強いキーがなく同名の作品が2つあれば ambiguous', () => {
    expect(match({ titles: ['Echoes'], developerNames: [] }).kind).toBe('ambiguous');
  });

  it('F03: 和英のタイトルは、公式サイトが同じなら同じ作品', () => {
    const r = match({
      titles: ['Stardust Atelier'],
      developerNames: [],
      officialUrl: 'https://stardust-atelier.example.jp/',
    });
    expect(r).toEqual({ kind: 'match', gameId: 'g_000004', via: 'strong-key' });
  });

  it('F04、F05: 体験版と DLC は本編の作品になる', () => {
    expect(match({ titles: ['Lantern Tide Demo'], developerNames: [], externalIds: { steamAppId: 900002 } })).toEqual({
      kind: 'match',
      gameId: 'g_000001',
      via: 'associated-app',
    });
    expect(
      match({ titles: ['Lantern Tide - Deep Currents'], developerNames: [], externalIds: { steamAppId: 900003 } }),
    ).toMatchObject({
      kind: 'match',
      gameId: 'g_000001',
    });
  });

  it('F06: 続編は別の作品', () => {
    expect(
      match({ titles: ['Lantern Tide 3'], developerNames: ['Small Harbor Games'], externalIds: { steamAppId: 900005 } })
        .kind,
    ).toBe('none');
  });

  it('タイトルが一致し開発者が重なれば probable、異なれば ambiguous', () => {
    expect(match({ titles: ['ランタンタイド'], developerNames: ['Small Harbor Games'] })).toEqual({
      kind: 'probable',
      gameId: 'g_000001',
    });
    expect(match({ titles: ['ランタンタイド'], developerNames: ['Another Team'] }).kind).toBe('ambiguous');
  });

  it('統合済みの作品とは照合しない', () => {
    // g_000007（Stardust Atelier）は g_000004 に統合済み。別名の照合は g_000004 だけに当たる
    const r = match({ titles: ['Stardust Atelier'], developerNames: [] });
    expect(r.kind === 'ambiguous' ? r.gameIds : r.kind === 'probable' ? [r.gameId] : []).not.toContain('g_000007');
  });
});

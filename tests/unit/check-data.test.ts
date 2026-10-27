import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkData } from '../../scripts/pipeline/data-checks.ts';

const FIXTURE = path.resolve('tests/fixtures/repo');
let dir: string | undefined;

/** フィクスチャを一時ディレクトリに写し、変更を加えてから検証する */
function withRepo(mutate: (root: string) => void): string[] {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-check-'));
  fs.cpSync(FIXTURE, dir, { recursive: true });
  mutate(dir);
  process.env.INDIEATLAS_ROOT = dir;
  return checkData().map((i) => i.rule);
}

function edit(root: string, rel: string, fn: (v: any) => void, raw = false): void {
  const file = path.join(root, rel);
  const v = JSON.parse(fs.readFileSync(file, 'utf8'));
  fn(v);
  fs.writeFileSync(file, raw ? JSON.stringify(v) : JSON.stringify(v, null, 2) + '\n');
}

afterEach(() => {
  delete process.env.INDIEATLAS_ROOT;
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('check:data（04 §4.10）', () => {
  it('正しいフィクスチャで通る', () => {
    expect(withRepo(() => {})).toEqual([]);
  });

  it('D-01: スキーマに合わない', () => {
    expect(withRepo((r) => edit(r, 'data/games/g_000001.json', (g) => (g.status = 'unknown')))).toContain('D-01');
  });

  it('D-01: ファイル名と ID が一致しない', () => {
    expect(
      withRepo((r) =>
        fs.renameSync(path.join(r, 'data/games/g_000002.json'), path.join(r, 'data/games/g_000099.json')),
      ),
    ).toContain('D-01');
  });

  it('D-02: 書式が違う', () => {
    expect(withRepo((r) => edit(r, 'data/games/g_000001.json', () => {}, true))).toContain('D-02');
  });

  it('D-02: 並び順が違う', () => {
    expect(withRepo((r) => edit(r, 'data/games/g_000001.json', (g) => g.aliases.reverse()))).toContain('D-02');
  });

  it('D-03: 開発者が存在しない', () => {
    expect(withRepo((r) => fs.rmSync(path.join(r, 'data/developers/dev_000002.json')))).toContain('D-03');
  });

  it('D-03: タグが存在しない', () => {
    expect(
      withRepo((r) =>
        edit(r, 'data/taxonomy/tags.json', (f) => (f.tags = f.tags.filter((t: { id: string }) => t.id !== 'puzzle'))),
      ),
    ).toContain('D-03');
  });

  it('D-04: 統合済みの作品へ統合する（連鎖）', () => {
    expect(withRepo((r) => edit(r, 'data/games/g_000007.json', (g) => (g.mergedInto = 'g_000007')))).toContain('D-04');
  });

  it('D-04: 統合済みの作品に記事の関連が残る', () => {
    const id = fs.readdirSync(path.join(FIXTURE, 'data/articles'))[0]!;
    expect(
      withRepo((r) => edit(r, `data/articles/${id}`, (a) => a.games.push({ gameId: 'g_000007', role: 'mention' }))),
    ).toContain('D-04');
  });

  it('D-05: 強いキーが重複する', () => {
    expect(withRepo((r) => edit(r, 'data/games/g_000003.json', (g) => (g.externalIds.steamAppId = 900010)))).toContain(
      'D-05',
    );
  });

  it('D-05: 付属アプリの ID が他の作品の強いキーと重複する', () => {
    expect(withRepo((r) => edit(r, 'data/games/g_000005.json', (g) => (g.externalIds.steamAppId = 900002)))).toContain(
      'D-05',
    );
  });

  it('D-06: 概要のない作品を公開している', () => {
    expect(
      withRepo((r) =>
        edit(
          r,
          'data/claims/g_000002.json',
          (f) => (f.claims = f.claims.filter((c: { field: string }) => c.field !== 'summary')),
        ),
      ),
    ).toContain('D-06');
  });

  it('D-06: インディーの理由がない作品を公開している', () => {
    expect(withRepo((r) => edit(r, 'data/games/g_000002.json', (g) => (g.indie.reasons = [])))).toContain('D-06');
  });

  it('D-07: Claim の ID が計算と一致しない', () => {
    expect(
      withRepo((r) => edit(r, 'data/claims/g_000002.json', (f) => (f.claims[0].id = 'c_0000000000000000'))),
    ).toContain('D-07');
  });

  it('D-07: superseded に supersededBy がない', () => {
    expect(
      withRepo((r) =>
        edit(r, 'data/claims/g_000001.json', (f) => {
          for (const c of f.claims) if (c.status === 'superseded') delete c.supersededBy;
        }),
      ),
    ).toContain('D-07');
  });

  it('D-07: 値が1つの項目で採用済みが2つある', () => {
    expect(
      withRepo((r) =>
        edit(r, 'data/claims/g_000001.json', (f) => {
          for (const c of f.claims) {
            if (c.status === 'superseded') {
              c.status = 'adopted';
              delete c.supersededBy;
            }
          }
        }),
      ),
    ).toContain('D-07');
  });

  it('D-08: 記事の ID が URL と一致しない', () => {
    const id = fs.readdirSync(path.join(FIXTURE, 'data/articles'))[0]!;
    expect(
      withRepo((r) => edit(r, `data/articles/${id}`, (a) => (a.canonicalUrl = 'https://news.example.jp/other'))),
    ).toContain('D-08');
  });

  it('D-09: 公開中のコレクションの作品が4件未満', () => {
    expect(withRepo((r) => edit(r, 'data/collections/col_0001.json', (c) => c.items.pop()))).toContain('D-09');
  });

  it('D-09: rules を満たさない作品を含む', () => {
    expect(
      withRepo((r) => edit(r, 'data/collections/col_0001.json', (c) => (c.items[0].gameId = 'g_000002'))),
    ).toContain('D-09');
  });

  it('D-10: 関係の a と b の順番が逆', () => {
    expect(
      withRepo((r) =>
        edit(r, 'data/relations/game-relations.json', (f) => {
          const x = f.relations[0];
          [x.a, x.b] = [x.b, x.a];
        }),
      ),
    ).toContain('D-10');
  });

  it('D-11: タグの別名が他のタグと重複する', () => {
    expect(
      withRepo((r) => edit(r, 'data/taxonomy/tags.json', (f) => f.tags[0].aliases.push('ローグライク'))),
    ).toContain('D-11');
  });

  it('D-12: done のタスクに resolution がない', () => {
    expect(withRepo((r) => edit(r, 'state/tasks.json', (f) => (f.tasks[0].status = 'done')))).toContain('D-12');
  });

  it('D-13: 有効な情報源の利用条件を確認していない', () => {
    expect(withRepo((r) => edit(r, 'config/sources.json', (f) => delete f.sources[0].rights.checkedAt))).toContain(
      'D-13',
    );
  });

  it('D-14: 機密情報らしい文字列がある', () => {
    expect(
      withRepo((r) =>
        fs.appendFileSync(path.join(r, 'config/policy.md'), '\nghp_abcdefghijklmnopqrstuvwxyz0123456789\n'),
      ),
    ).toContain('D-14');
  });
});

import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareSite } from '../../scripts/build/prepare-site.ts';
import { buildSiteData, prominenceOf } from '../../scripts/build/site-data.ts';
import { loadRepo, type RepoData } from '../../scripts/lib/repo-io.ts';

const CODE = {
  src: 'a',
  public: 'b',
  schema: 'c',
  'scripts/build': 'd',
  'astro.config.mjs': 'e',
  'package-lock.json': 'f',
};
let repo: () => RepoData;

beforeAll(() => {
  process.env.INDIEATLAS_ROOT = path.resolve('tests/fixtures/repo');
  repo = () => loadRepo();
});
afterAll(() => {
  delete process.env.INDIEATLAS_ROOT;
});

const hashOf = (r: RepoData) => prepareSite(r, CODE).meta.contentHash;

describe('公開内容ハッシュ（07 §7.4.1）', () => {
  it('同じデータからは同じハッシュになる', () => {
    expect(hashOf(repo())).toBe(hashOf(repo()));
  });

  it('確認日時（lastCheckedAt、retrievedAt を元にした checkedAt）だけを変えてもハッシュは変わらない', () => {
    const r = repo();
    for (const f of r.claims.values()) {
      for (const c of f.claims) {
        c.lastCheckedAt = '2030-01-01T00:00:00Z';
      }
    }
    expect(hashOf(r)).toBe(hashOf(repo()));
  });

  it('表示に関わる項目を変えるとハッシュが変わる', () => {
    const r = repo();
    r.games.find((g) => g.id === 'g_000001')!.title.display = 'ランタン・タイド';
    expect(hashOf(r)).not.toBe(hashOf(repo()));
  });

  it('ベースパスが変わるとハッシュが変わる', () => {
    const before = hashOf(repo());
    process.env.BASE_PATH = '/indieatlas/';
    try {
      expect(hashOf(repo())).not.toBe(before);
    } finally {
      delete process.env.BASE_PATH;
    }
  });

  it('コードのハッシュが変わるとハッシュが変わる', () => {
    expect(prepareSite(repo(), { ...CODE, src: 'z' }).meta.contentHash).not.toBe(hashOf(repo()));
  });
});

describe('サイト用データ（03 §3.7）', () => {
  it('根拠の抜粋と内部の情報を含まない', () => {
    const text = JSON.stringify(prepareSite(repo(), CODE).files);
    expect(text).not.toContain('"quote"');
    expect(text).not.toContain('quoteHash');
    expect(text).not.toContain('identityEvidence');
    expect(text).not.toContain('disambiguation');
    expect(text).not.toContain('we have decided to move the PC launch');
  });

  it('公開中の作品だけを含み、統合済みの作品は転送先を持つ', () => {
    const d = buildSiteData(repo());
    expect(d.games.map((g) => g.id)).toEqual(['g_000001', 'g_000002', 'g_000003', 'g_000004', 'g_000006', 'g_000008']);
    expect(d.redirects).toEqual([{ from: 'g_000007', to: 'g_000004' }]);
  });

  it('延期の履歴と、全体の発売状況', () => {
    const g = buildSiteData(repo()).games.find((x) => x.id === 'g_000001')!;
    expect(g.release!.overall.status).toBe('upcoming');
    expect(g.release!.history).toHaveLength(1);
    expect(g.release!.history[0]!.label).toBe('2026年 冬 発売予定');
    expect(g.release!.entries.map((e) => `${e.platform}:${e.label}`)).toEqual([
      'pc:2027年 春 発売予定',
      'switch:2027年 発売予定',
    ]);
    expect(g.platforms).toEqual(['pc', 'switch']);
  });

  it('いずれかの機種で発売済みなら全体を発売中にする', () => {
    const g = buildSiteData(repo()).games.find((x) => x.id === 'g_000003')!;
    expect(g.release!.overall).toMatchObject({ status: 'released', label: '発売中（2024年11月8日 発売）' });
  });

  it('値のない項目は null', () => {
    const g = buildSiteData(repo()).games.find((x) => x.id === 'g_000002')!;
    expect(g.japaneseSupport).toBeNull();
    expect(g.features).toBeNull();
  });

  it('関連作品: 保存された関係と同じ開発者の作品', () => {
    const d = buildSiteData(repo());
    const g3 = d.games.find((x) => x.id === 'g_000003')!;
    expect(g3.related).toEqual([
      { gameId: 'g_000006', kind: 'similar-play', reason: expect.stringContaining('ローグライク') },
    ]);
  });

  it('記事: 権利条件に従って説明を出し、公開中の作品だけに関連づける', () => {
    const d = buildSiteData(repo());
    const news = d.articles.find((a) => a.kind === 'news')!;
    expect(news.summaryJa).toBeTruthy();
    const roundup = d.articles.find((a) => a.kind === 'roundup')!;
    expect(roundup.summaryJa).toBeUndefined();
    expect(roundup.games.map((g) => g.role)).toEqual(['roundup', 'roundup', 'roundup']);
  });

  it('索引用の別名に仮名の変換を含む', () => {
    const g = buildSiteData(repo()).games.find((x) => x.id === 'g_000001')!;
    expect(g.aliases).toEqual(expect.arrayContaining(['Lantern Tide', 'らんたんたいど', 'ランタン・タイド']));
  });
});

describe('ジャンルのカテゴリ色', () => {
  it('主なジャンルを作品の多い順に最大8件並べる', () => {
    const d = buildSiteData(repo());
    expect(d.genres.length).toBeGreaterThan(0);
    expect(d.genres.length).toBeLessThanOrEqual(8);
    expect(d.genres).toContainEqual({ id: 'roguelike', label: 'ローグライク' });
  });

  it('知名度の区分は Steam のレビュー数で決まる', () => {
    expect(prominenceOf(undefined)).toBe('standard');
    expect(prominenceOf(29_999)).toBe('standard');
    expect(prominenceOf(30_000)).toBe('notable');
    expect(prominenceOf(150_000)).toBe('landmark');
  });
});

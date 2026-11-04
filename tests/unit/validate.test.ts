import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Operation, TaskResult } from '../../schema/proposal.ts';
import type { FetchLogEntry } from '../../schema/research-output.ts';
import type { Task } from '../../schema/state.ts';
import { loadRepo } from '../../scripts/lib/repo-io.ts';
import { applyTaskResult, createWorkspace, type Workspace } from '../../scripts/pipeline/apply.ts';
import { makeTask } from '../../scripts/pipeline/tasks.ts';
import { datesInText, eventDatesSupported } from '../../scripts/pipeline/validate/event-dates.ts';
import { indexFetchLog } from '../../scripts/pipeline/validate/evidence.ts';
import { textIssues } from '../../scripts/pipeline/validate/text-rules.ts';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-validate-'));
  fs.cpSync(path.resolve('tests/fixtures/repo'), dir, { recursive: true });
  process.env.INDIEATLAS_ROOT = dir;
});
afterEach(() => {
  delete process.env.INDIEATLAS_ROOT;
  fs.rmSync(dir, { recursive: true, force: true });
});

const at = '2026-10-27T00:20:00Z';
const ARTICLE = 'https://news.example.jp/articles/lantern-tide-preview';
const log = (url: string, text: string, extra: Partial<FetchLogEntry> = {}): FetchLogEntry => ({
  schemaVersion: 1,
  fetchId: 'f_0001',
  tool: 'fetch_url',
  url,
  finalUrl: url,
  status: 200,
  retrievedAt: at,
  contentType: 'text/html',
  fetchHash: `sha256:${'a'.repeat(64)}`,
  title: 'Lantern Tide 先行プレイ',
  text,
  noai: false,
  ...extra,
});
const BODY =
  'Small Harbor Games の新作『Lantern Tide』は、灯台守の少女が潮の満ち引きで姿を変える群島を探索するアドベンチャーだ。PC版は2027年春に発売予定。';

function workspace(entries: FetchLogEntry[]): Workspace {
  return createWorkspace(loadRepo(), { at, today: '2026-10-27', runId: 'local-test', log: indexFetchLog(entries) });
}
const result = (operations: Operation[]): TaskResult => ({
  taskId: 't_0000000000000000',
  outcome: 'completed',
  summary: 'test',
  operations,
  followUpTasks: [],
  injectionDetected: false,
});
const articleTask = (): Task => makeTask('process-article', { url: ARTICLE }, '記事を処理する', 'collector', at);
const rules = (ws: Workspace) => ws.rejectionLog.map((r) => r.rule);

const summaryClaim = (gameId: string, ja: string, quote: string, url = ARTICLE): Operation => ({
  op: 'add-claim',
  game: { gameId },
  claim: {
    field: 'summary',
    scope: {},
    value: { ja },
    basis: 'editorial',
    asOf: '2026-10-27',
    evidence: [{ url, quote }],
  },
});

describe('根拠の検証（06 §6.7.2、受入基準4）', () => {
  it('取得ログにない URL の根拠を却下する（V-E01）', () => {
    const ws = workspace([log(ARTICLE, BODY)]);
    applyTaskResult(
      ws,
      makeTask('fill-missing', { gameId: 'g_000006', field: 'summary' }, '紹介文を書く', 'scheduler', at),
      result([
        summaryClaim(
          'g_000006',
          '深い洞窟を降りながらデッキを組み替えるローグライクのカードゲーム。階層ごとに変わる敵の組み合わせに合わせて戦い方を選ぶ。',
          '潮の満ち引きで姿を変える群島',
          'https://other.example.jp/x',
        ),
      ]),
    );
    expect(rules(ws)).toContain('V-E01');
    expect(ws.counts.claimsAdded).toBe(0);
  });

  it('本文にない抜粋を却下する（V-E02）', () => {
    const ws = workspace([log(ARTICLE, BODY)]);
    applyTaskResult(
      ws,
      articleTask(),
      result([
        {
          op: 'upsert-article',
          article: {
            url: ARTICLE,
            title: 'Lantern Tide 先行プレイ',
            outletName: 'Example News',
            lang: 'ja',
            kind: 'preview',
            games: [{ ref: { gameId: 'g_000001' }, role: 'primary' }],
          },
        },
        {
          op: 'add-claim',
          game: { gameId: 'g_000001' },
          claim: {
            field: 'release',
            scope: { platform: 'switch', region: 'global' },
            value: { status: 'upcoming', date: { precision: 'year', year: 2027 } },
            basis: 'reported',
            asOf: '2026-10-27',
            evidence: [{ url: ARTICLE, quote: 'Switch版は2027年に発売予定' }],
          },
        },
      ]),
    );
    expect(rules(ws)).toContain('V-E02');
    expect(ws.newArticles).toHaveLength(1);
  });

  it('対象の作品を扱っていないページの根拠を却下する（V-E03）', () => {
    const ws = workspace([log(ARTICLE, BODY)]);
    applyTaskResult(
      ws,
      makeTask('fill-missing', { gameId: 'g_000008', field: 'summary' }, '紹介文を書く', 'scheduler', at),
      result([
        summaryClaim(
          'g_000008',
          '苔むした庭を手入れしながら、小さな生き物たちと静かに暮らすスローライフのシミュレーション作品として描かれる。',
          '灯台守の少女が潮の満ち引きで姿を変える群島を探索する',
        ),
      ]),
    );
    expect(rules(ws)).toContain('V-E03');
  });

  it('通った根拠には、種類、originKey、取得日時をコードが補う', () => {
    const ws = workspace([log(ARTICLE, BODY)]);
    applyTaskResult(
      ws,
      articleTask(),
      result([
        {
          op: 'upsert-article',
          article: {
            url: ARTICLE,
            title: 'Lantern Tide 先行プレイ',
            outletName: 'Example News',
            lang: 'ja',
            kind: 'preview',
            games: [{ ref: { gameId: 'g_000001' }, role: 'primary' }],
          },
        },
        {
          op: 'add-claim',
          game: { gameId: 'g_000001' },
          claim: {
            field: 'release',
            scope: { platform: 'pc', region: 'global' },
            value: {
              status: 'upcoming',
              date: { precision: 'season', year: 2027, season: 'spring' },
              rawText: '2027年春',
            },
            basis: 'reported',
            asOf: '2026-10-27',
            evidence: [{ url: ARTICLE, quote: 'PC版は2027年春に発売予定' }],
          },
        },
      ]),
    );
    expect(ws.rejectionLog).toEqual([]);
    const claims = ws.repo.claims.get('g_000001')!.claims;
    const added = [...(ws.newClaimIds.get('g_000001') ?? [])];
    // 採用済みと同じ値なので同じ ID になり、根拠が追記される
    expect(added).toHaveLength(0);
    const adopted = claims.find((c) => c.field === 'release' && c.scope.platform === 'pc' && c.status === 'adopted')!;
    const media = adopted.evidence.find((e) => e.kind === 'media')!;
    expect(media).toMatchObject({ sourceId: 'example-news-jp', originKey: 'media:example.jp', retrievedAt: at });
    expect(ws.repo.articles.find((a) => a.canonicalUrl === ARTICLE)?.games).toEqual([
      { gameId: 'g_000001', role: 'primary' },
    ]);
  });

  it('本文に名前がない作品は記事に関連づけない', () => {
    const ws = workspace([log(ARTICLE, BODY)]);
    applyTaskResult(
      ws,
      articleTask(),
      result([
        {
          op: 'upsert-article',
          article: {
            url: ARTICLE,
            title: 'Lantern Tide 先行プレイ',
            outletName: 'Example News',
            lang: 'ja',
            kind: 'preview',
            games: [
              { ref: { gameId: 'g_000001' }, role: 'primary' },
              { ref: { gameId: 'g_000008' }, role: 'mention' },
            ],
          },
        },
      ]),
    );
    expect(ws.repo.articles.find((a) => a.canonicalUrl === ARTICLE)?.games.map((g) => g.gameId)).toEqual(['g_000001']);
    expect(rules(ws)).toContain('V-E03');
  });
});

describe('内容と範囲の検証（06 §6.7.1、§6.7.3）', () => {
  it('使わない表現を含む紹介文を却下する（V-C01）', () => {
    const ws = workspace([log(ARTICLE, BODY)]);
    applyTaskResult(
      ws,
      makeTask('fill-missing', { gameId: 'g_000001', field: 'summary' }, '紹介文', 'scheduler', at),
      result([
        summaryClaim(
          'g_000001',
          '灯台守の少女となり群島を探索する、間違いなく今年最高の傑作アドベンチャー。潮の満ち引きで地形が変わる島々を巡り秘密を解き明かす。',
          '灯台守の少女が潮の満ち引きで姿を変える群島を探索する',
        ),
      ]),
    );
    expect(rules(ws)).toContain('V-C01');
  });

  it('言い換えだけの紹介文の置き換えを却下する（V-C04）', () => {
    const ws = workspace([log(ARTICLE, BODY)]);
    applyTaskResult(
      ws,
      makeTask('fill-missing', { gameId: 'g_000001', field: 'summary' }, '紹介文', 'scheduler', at),
      result([
        summaryClaim(
          'g_000001',
          '潮の満ち引きで姿を変える群島を、灯台守の少女として探索するアドベンチャー。満潮と干潮で道や遺跡の現れ方が変わっていく作品になっている。',
          '灯台守の少女が潮の満ち引きで姿を変える群島を探索する',
        ),
      ]),
    );
    expect(rules(ws)).toContain('V-C04');
  });

  it('「対象の作品だけ」のタスクでは、対象以外を変更しない（V-S05）', () => {
    const ws = workspace([log(ARTICLE, BODY)]);
    applyTaskResult(
      ws,
      makeTask('check-change', { gameId: 'g_000006' }, '発売情報', 'scheduler', at),
      result([
        {
          op: 'add-claim',
          game: { gameId: 'g_000001' },
          claim: {
            field: 'release',
            scope: { platform: 'pc', region: 'global' },
            value: { status: 'upcoming', date: { precision: 'season', year: 2027, season: 'spring' } },
            basis: 'reported',
            asOf: '2026-10-27',
            evidence: [{ url: ARTICLE, quote: 'PC版は2027年春に発売予定' }],
          },
        },
      ]),
    );
    expect(rules(ws)).toContain('V-S05');
  });

  it('タスクの種類に許されない操作を却下する（V-S04）', () => {
    const ws = workspace([]);
    applyTaskResult(
      ws,
      makeTask('check-change', { gameId: 'g_000001' }, '発売情報', 'scheduler', at),
      result([
        {
          op: 'propose-merge',
          gameIds: ['g_000002', 'g_000003'],
          keep: 'g_000002',
          reason: 'same',
          evidence: [{ url: ARTICLE, quote: 'Echoes は同じ作品である' }],
        },
      ]),
    );
    expect(rules(ws)).toEqual(['V-S04']);
  });

  it('識別の根拠のない新しい作品を却下し、その一時 ID を使う操作も連鎖して却下する（V-I01）', () => {
    const ws = workspace([log(ARTICLE, `${BODY} Tidewright という新作も紹介された。`)]);
    applyTaskResult(
      ws,
      articleTask(),
      result([
        {
          op: 'create-game',
          tempId: 'new:1',
          identity: {
            title: { display: 'Tidewright', original: 'Tidewright', originalLang: 'en' },
            aliases: [],
            externalIds: {},
            associatedApps: [],
            developers: [{ name: 'Tide Team' }],
            publishers: [],
            evidence: [{ field: 'title', evidence: { url: ARTICLE, quote: 'Tidewright という新作も紹介された' } }],
            indieReasons: [],
          },
        },
        {
          op: 'upsert-article',
          article: {
            url: ARTICLE,
            title: 'Lantern Tide 先行プレイ',
            outletName: 'Example News',
            lang: 'ja',
            kind: 'preview',
            games: [
              { ref: { gameId: 'g_000001' }, role: 'primary' },
              { ref: { tempId: 'new:1' }, role: 'mention' },
            ],
          },
        },
      ]),
    );
    expect(rules(ws)).toEqual(expect.arrayContaining(['V-I01', 'V-S02']));
    expect(ws.createdGames).toEqual([]);
    expect(ws.repo.articles.find((a) => a.canonicalUrl === ARTICLE)?.games.map((g) => g.gameId)).toEqual(['g_000001']);
  });

  it('1回の実行で作る作品の上限を超えた分はタスクに戻す（V-L01）', () => {
    const ws = workspace([
      log('https://tidewright.example.com/', 'Tidewright はひとりで開発している海の作品です。', {
        title: 'Tidewright',
      }),
    ]);
    ws.repo.runtime.limits.maxNewGames = 0;
    applyTaskResult(
      ws,
      makeTask('register-game', { name: 'Tidewright' }, '登録する', 'collector', at),
      result([
        {
          op: 'create-game',
          tempId: 'new:1',
          identity: {
            title: { display: 'Tidewright', original: 'Tidewright', originalLang: 'en' },
            aliases: [],
            externalIds: {},
            associatedApps: [],
            officialUrl: 'https://tidewright.example.com/',
            developers: [{ name: 'Tide Team' }],
            publishers: [],
            evidence: [
              {
                field: 'officialUrl',
                evidence: { url: 'https://tidewright.example.com/', quote: 'Tidewright はひとりで開発している' },
              },
            ],
            indieReasons: [],
          },
        },
      ]),
    );
    expect(rules(ws)).toContain('V-L01');
    expect(ws.newTasks.map((t) => t.type)).toEqual(['register-game']);
  });
});

describe('記事と取得ログの扱い', () => {
  it('セールの告知は記事にしない（V-C06）', () => {
    const url = 'https://news.example.jp/articles/lantern-tide-sale';
    const ws = workspace([
      log(url, `${BODY} 発売記念で90%オフになる。`, { title: '『Lantern Tide』が90%オフの過去最安に' }),
    ]);
    applyTaskResult(
      ws,
      makeTask('process-article', { url }, '記事を処理する', 'collector', at),
      result([
        {
          op: 'upsert-article',
          article: {
            url,
            title: '『Lantern Tide』が90%オフの過去最安に',
            outletName: 'Example News',
            lang: 'ja',
            kind: 'news',
            games: [{ ref: { gameId: 'g_000001' }, role: 'primary' }],
          },
        },
      ]),
    );
    expect(rules(ws)).toEqual(['V-C06']);
    expect(ws.newArticles).toEqual([]);
  });

  it('同じストアのページを2回取得していても、quote と locator はそれぞれ合う取得ログで確かめる', () => {
    const store = 'https://store.steampowered.com/app/900001/';
    const steam = log(store, 'Lantern Tide\nExplore an archipelago that changes with the tides.', {
      fetchId: 'f_0002',
      tool: 'get_steam_app',
      steam: { appId: 900001, type: 'game', release: { status: 'upcoming' }, platforms: ['pc'] },
    });
    const html = log(store, 'Lantern Tide on Steam. About this game: Light the lighthouses to open new sea routes.', {
      fetchId: 'f_0003',
      retrievedAt: '2026-10-27T00:30:00Z',
    });
    const ws = workspace([steam, html]);
    applyTaskResult(
      ws,
      makeTask('fill-missing', { gameId: 'g_000001', field: 'summary' }, '紹介文', 'scheduler', at),
      result([
        {
          op: 'add-claim',
          game: { gameId: 'g_000001' },
          claim: {
            field: 'tag',
            scope: {},
            value: { tagId: 'puzzle' },
            basis: 'editorial',
            asOf: '2026-10-27',
            evidence: [{ url: store, quote: 'Light the lighthouses to open new sea routes.' }],
          },
        },
        {
          op: 'confirm-claim',
          claimId: 'c_e1bad21b690ba325',
          evidence: [{ url: store, locator: 'steam:appdetails.steam_appid' }],
        },
      ]),
    );
    expect(ws.rejectionLog).toEqual([]);
  });
});

describe('文章の規則（05 §5.6.3）', () => {
  it('評価、宣伝、推測、URL、絵文字を検出する', () => {
    expect(textIssues('名作と呼ばれる作品').map((i) => i.category)).toEqual(['根拠のない評価']);
    expect(textIssues('今すぐ遊べる').map((i) => i.category)).toEqual(['宣伝の口調']);
    expect(textIssues('人気が出るだろう').map((i) => i.category)).toEqual(['推測']);
    expect(textIssues('詳しくは https://example.com で').map((i) => i.category)).toContain('URL');
    expect(textIssues('かわいい🐱').map((i) => i.category)).toContain('絵文字');
    expect(textIssues('灯台守の少女となり、群島を探索する海洋アドベンチャー。')).toEqual([]);
  });
});

describe('催しの日付（V-EV01）', () => {
  it('日本語と英語の表記から日付を読み取る', () => {
    expect(datesInText('2027年3月14日（日）〜15日（月）に開催')).toEqual([
      { year: 2027, month: 3, day: 14 },
      { year: 2027, month: 3, day: 15 },
    ]);
    expect(datesInText('Steam Next Fest: February 23 – March 2, 2027')).toEqual(
      expect.arrayContaining([
        { year: 2027, month: 2, day: 23 },
        { year: 2027, month: 3, day: 2 },
      ]),
    );
    expect(datesInText('会期 2027/7/18-19')).toEqual(expect.arrayContaining([{ year: 2027, month: 7, day: 18 }]));
  });

  it('開始日と終了日が抜粋の日付に一致するかを確かめる', () => {
    const start = { precision: 'day' as const, year: 2027, month: 3, day: 14 };
    const end = { precision: 'day' as const, year: 2027, month: 3, day: 15 };
    expect(eventDatesSupported(start, end, ['会期は2027年3月14日（日）〜15日（月）'])).toBe(true);
    expect(eventDatesSupported(start, end, ['会期は2027年3月21日（日）〜22日（月）'])).toBe(false);
    expect(eventDatesSupported({ precision: 'month', year: 2027, month: 7 }, undefined, ['2027年7月に開催予定'])).toBe(
      true,
    );
  });
});

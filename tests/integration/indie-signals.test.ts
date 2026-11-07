import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadRepo } from '../../scripts/lib/repo-io.ts';
import { adoptResearch, writeWorkspace, type AdoptOptions } from '../../scripts/pipeline/adopt-core.ts';
import { checkData } from '../../scripts/pipeline/data-checks.ts';
import { scheduleTasks } from '../../scripts/pipeline/tasks.ts';
import { indieTopSellersUrl } from '../../scripts/sources/steam.ts';
import { fakeHttp, steamRoutes } from '../helpers/fake-http.ts';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-signals-'));
  fs.cpSync(path.resolve('tests/fixtures/repo'), root, { recursive: true });
  process.env.INDIEATLAS_ROOT = root;
  process.env.INDIEATLAS_NOW = '2026-10-27T00:20:00Z';
});
afterEach(() => {
  delete process.env.INDIEATLAS_ROOT;
  delete process.env.INDIEATLAS_NOW;
  fs.rmSync(root, { recursive: true, force: true });
});

const opts: AdoptOptions = {
  at: '2026-10-27T00:40:00Z',
  today: '2026-10-27',
  runId: '1001',
  runAttempt: 1,
  trigger: 'schedule',
  triggerCommit: 'a'.repeat(40),
};

describe('売れ筋と記事に出てくる作品の収録', () => {
  it('Steam のインディーの売上上位の作品を登録し、インディーとして扱う', async () => {
    const steamHttp = fakeHttp({
      [indieTopSellersUrl()]: 'steam/topsellers.json',
      ...steamRoutes(900101, 900199, 900301),
    });
    const lines: string[] = [];
    const r = await adoptResearch(loadRepo(), undefined, { ...opts, steamHttp, log: (l) => lines.push(l) });
    writeWorkspace(r);
    expect(checkData()).toEqual([]);
    const repo = loadRepo();

    // 開発者とパブリッシャーが違っても、売上上位に入っていればインディーと判定する
    const lamp = repo.games.find((g) => g.externalIds.steamAppId === 900301)!;
    expect(lamp.status).toBe('candidate');
    expect(lamp.indie.assessment).toBe('indie');
    expect(lamp.indie.reasons.map((x) => x.code)).toEqual(['indie-top-seller']);
    // 自分で販売している作品は、売上上位の理由を加えない
    const tide = repo.games.find((g) => g.externalIds.steamAppId === 900101)!;
    expect(tide.indie.reasons.map((x) => x.code)).toEqual(['self-published']);
    // 成人向けの作品は登録しない
    expect(repo.games.some((g) => g.externalIds.steamAppId === 900199)).toBe(false);
    expect(lines.some((l) => l.startsWith('top-sellers 900199'))).toBe(true);
    // 取得に失敗したら、残りの作品は次の回に登録する
    expect(steamHttp.requested.some((u) => u.includes('900401'))).toBe(true);
    expect(steamHttp.requested.some((u) => u.includes('900402'))).toBe(false);

    // 紹介文を書けば公開できる作品から、紹介文のタスクを作る
    const fill = scheduleTasks(repo, '2026-10-28', '2026-10-28T00:00:00Z').newTasks.filter(
      (t) => t.type === 'fill-missing',
    );
    expect(fill.map((t) => t.target.gameId)).toContain(lamp.id);
  });

  it('記事で取り上げられた候補の作品を、インディーとして扱う', async () => {
    const repo = loadRepo();
    const game = repo.games.find((g) => g.id === 'g_000005')!;
    game.indie = { assessment: 'unknown', reasons: [], assessedAt: '2026-10-20T00:00:00Z' };
    const article = repo.articles[0]!;
    article.games.push({ gameId: game.id, role: 'mention' });
    const r = await adoptResearch(repo, undefined, opts);
    writeWorkspace(r);
    expect(checkData()).toEqual([]);

    const after = loadRepo().games.find((g) => g.id === game.id)!;
    expect(after.indie.assessment).toBe('indie');
    expect(after.indie.reasons).toEqual([
      expect.objectContaining({
        code: 'indie-coverage',
        evidence: [expect.objectContaining({ kind: 'media', url: article.url, articleId: article.id })],
      }),
    ]);
  });
});

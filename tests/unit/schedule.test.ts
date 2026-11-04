import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadRepo } from '../../scripts/lib/repo-io.ts';
import { makeTask, scheduleTasks } from '../../scripts/pipeline/tasks.ts';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-schedule-'));
  fs.cpSync(path.resolve('tests/fixtures/repo'), dir, { recursive: true });
  process.env.INDIEATLAS_ROOT = dir;
});
afterEach(() => {
  delete process.env.INDIEATLAS_ROOT;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('定期的なタスク（06 §6.4.1）', () => {
  it('同じ ID のタスクを重ねて作らない', () => {
    const repo = loadRepo();
    const first = scheduleTasks(repo, '2026-10-27', '2026-10-27T00:00:00Z');
    repo.tasks.tasks.push(...first.newTasks);
    const again = scheduleTasks(repo, '2026-10-27', '2026-10-27T00:00:00Z');
    expect(again.newTasks.filter((t) => t.type !== 'register-event')).toEqual([]);
  });

  it('紹介文のない作品に fill-missing を作る', () => {
    const repo = loadRepo();
    const claims = repo.claims.get('g_000008');
    if (claims) claims.claims = claims.claims.filter((c) => c.field !== 'summary');
    const r = scheduleTasks(repo, '2026-10-27', '2026-10-27T00:00:00Z');
    expect(r.newTasks.some((t) => t.type === 'fill-missing' && t.target.gameId === 'g_000008')).toBe(true);
  });

  it('作ってから14日を過ぎた記事のタスクを期限切れにする', () => {
    const repo = loadRepo();
    const old = makeTask(
      'process-article',
      { url: 'https://news.example.jp/a/old' },
      '記事を処理する',
      'collector',
      '2026-10-01T00:00:00Z',
    );
    const fresh = makeTask(
      'process-article',
      { url: 'https://news.example.jp/a/new' },
      '記事を処理する',
      'collector',
      '2026-10-25T00:00:00Z',
    );
    repo.tasks.tasks.push(old, fresh);
    expect(scheduleTasks(repo, '2026-10-27', '2026-10-27T00:00:00Z').expired).toEqual([old.id]);
  });

  it('終わってから期間を過ぎた定期的なタスクは作り直す', () => {
    const repo = loadRepo();
    const claims = repo.claims.get('g_000008');
    if (claims) claims.claims = claims.claims.filter((c) => c.field !== 'summary');
    const t = scheduleTasks(repo, '2026-10-27', '2026-10-27T00:00:00Z').newTasks.find(
      (x) => x.type === 'fill-missing' && x.target.gameId === 'g_000008',
    )!;
    repo.tasks.tasks.push({
      ...t,
      status: 'done',
      resolution: { at: '2026-10-01T00:00:00Z', runId: '1', outcome: 'not-found', summary: 'x' },
    });
    expect(scheduleTasks(repo, '2026-10-27', '2026-10-27T00:00:00Z').newTasks.map((x) => x.id)).toContain(t.id);
    expect(scheduleTasks(repo, '2026-10-05', '2026-10-05T00:00:00Z').newTasks.map((x) => x.id)).not.toContain(t.id);
  });
});

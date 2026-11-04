import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RuntimeConfig } from '../../schema/config.ts';
import type { Task } from '../../schema/state.ts';
import { PROJECT_ROOT, readJson } from '../../scripts/lib/repo-io.ts';
import { Budget } from '../../scripts/pipeline/budget.ts';
import { correctPlan } from '../../scripts/pipeline/plan.ts';
import {
  applyOutcome,
  isoWeek,
  makeTask,
  orderForExecution,
  priority,
  selectBaseline,
  type PriorityContext,
} from '../../scripts/pipeline/tasks.ts';

const runtime = readJson(RuntimeConfig, path.join(PROJECT_ROOT, 'config/runtime.json'));
const at = '2026-10-27T00:00:00Z';
const ctx = (over: Partial<PriorityContext> = {}): PriorityContext => ({
  today: '2026-10-27',
  articleCount: () => 5,
  releaseWithinDays: () => false,
  itemPublishedAt: () => undefined,
  lowCoverage: 1,
  ...over,
});
const task = (type: Task['type'], target: Task['target'], createdAt = at): Task => ({
  ...makeTask(type, target, '目的を書く', 'scheduler', createdAt),
});

describe('優先度（06 §6.4.2）', () => {
  it('加点で段階の順序が入れ替わらない', () => {
    const old = task('fill-missing', { gameId: 'g_000001', field: 'summary' }, '2026-01-01T00:00:00Z');
    const fresh = task('check-change', { gameId: 'g_000002' });
    const c = ctx({ articleCount: (id) => (id === 'g_000001' ? 0 : 5) });
    expect(priority(old, c)).toBeLessThan(priority(fresh, c));
    expect(priority(old, c)).toBe(400 + 60 + 60); // 経過日数（30日まで）と報道の少なさ
  });

  it('試行の回数で下がる', () => {
    const t = { ...task('check-change', { gameId: 'g_000001' }), attempts: 2 };
    expect(priority(t, ctx())).toBe(800 - 100);
  });
});

describe('選択（06 §6.4.3）', () => {
  it('段階1を半分まで、探索の枠を確保し、同じ作品は上限まで', () => {
    const tasks = [
      ...Array.from({ length: 8 }, (_, i) => task('fix-conflict', { gameId: `g_00010${i}`, field: 'release' })),
      task('check-change', { gameId: 'g_000001' }),
      task('fill-missing', { gameId: 'g_000001', field: 'summary' }),
      task('refresh-game', { gameId: 'g_000001' }),
      task('discover', { sourceId: 'bitsummit' }),
      ...Array.from({ length: 10 }, (_, i) => task('process-article', { url: `https://news.example.jp/a/${i}` })),
    ];
    const s = selectBaseline(tasks, runtime, ctx(), new Set(['bitsummit']), 12);
    expect(s.selected).toHaveLength(12);
    expect(s.selected.filter((t) => t.type === 'fix-conflict')).toHaveLength(6);
    expect(s.selected.some((t) => t.type === 'discover')).toBe(true);
    expect(s.selected.filter((t) => t.target.gameId === 'g_000001').length).toBeLessThanOrEqual(
      runtime.run.maxTasksPerGame,
    );
    // 実行の順番: 段階1を2件 → 探索を1件 → 残り
    expect(s.selected.slice(0, 3).map((t) => t.type)).toEqual(['fix-conflict', 'fix-conflict', 'discover']);
  });

  it('LLM の計画から段階1が抜けていれば補い、枠を超えた分を外す', () => {
    const fix = task('fix-conflict', { gameId: 'g_000009', field: 'release' });
    const arts = Array.from({ length: 5 }, (_, i) =>
      task('process-article', { url: `https://news.example.jp/b/${i}` }),
    );
    const baseline = {
      selected: [fix, ...arts.slice(0, 2)],
      exploration: new Set<string>(),
      candidates: [fix, ...arts],
    };
    const out = correctPlan(
      { selected: arts.map((t) => ({ taskId: t.id, why: 'x' })), newTasks: [], notes: '' },
      baseline,
      runtime,
      3,
    );
    expect(out.map((t) => t.id)).toEqual([fix.id, arts[0]!.id, arts[1]!.id]);
  });

  it('orderForExecution は探索を3番目までに入れる', () => {
    const a = task('process-article', { url: 'https://news.example.jp/c/1' });
    const b = task('process-article', { url: 'https://news.example.jp/c/2' });
    const d = task('discover', { sourceId: 'x' });
    expect(orderForExecution([a, b, d], new Set([d.id])).map((t) => t.id)).toEqual([d.id, a.id, b.id]);
  });
});

describe('状態の遷移（04 §4.8.2）', () => {
  const base = task('check-change', { gameId: 'g_000001' });
  const o = { at, runId: 'local-test', today: '2026-10-27', summary: 'done' };
  it('completed と irrelevant は done', () => {
    expect(applyOutcome(base, 'completed', o)).toMatchObject({ status: 'done', resolution: { outcome: 'completed' } });
  });
  it('failed は3回目で blocked、6回目で dropped', () => {
    expect(applyOutcome({ ...base, attempts: 1 }, 'failed', o)).toMatchObject({ status: 'open', attempts: 2 });
    expect(applyOutcome({ ...base, attempts: 2 }, 'failed', o)).toMatchObject({
      status: 'blocked',
      attempts: 3,
      recheck: { after: '2026-11-10' },
    });
    expect(applyOutcome({ ...base, attempts: 5 }, 'failed', o)).toMatchObject({ status: 'dropped' });
  });
  it('deferred は試行の回数を増やさない', () => {
    expect(applyOutcome(base, 'deferred', o)).toEqual(base);
  });
});

describe('ISO 週', () => {
  it('年をまたぐ週を正しく数える', () => {
    expect(isoWeek('2026-11-04')).toBe('2026-W45');
    expect(isoWeek('2027-01-01')).toBe('2026-W53');
  });
});

describe('予算（06 §6.5.4）', () => {
  it('月の残りが0なら LLM を使わない', () => {
    const b = new Budget({ ...runtime, budget: { ...runtime.budget, monthlyLimit: 5 } }, Date.now(), 5);
    expect(b.monthExhausted).toBe(true);
    b.dispose();
  });
  it('1回の上限に達したら新しいタスクを始めない', () => {
    const b = new Budget(runtime, Date.now(), 0);
    b.record(runtime.budget.perRunLimit);
    expect(b.canStartTask(false, false)).toBe('cost-budget');
    b.dispose();
  });
  it('探索のタスクが残る間は、探索以外が確保分を使えない', () => {
    const b = new Budget(runtime, Date.now(), 0);
    b.record(runtime.budget.perRunLimit * (1 - runtime.exploration.minTaskShare));
    expect(b.canStartTask(false, true)).toBe('cost-budget');
    expect(b.canStartTask(true, true)).toBe('ok');
    b.dispose();
  });
  it('1タスクの上限を超えるときは、提出を促す最後の1回だけを許す', () => {
    const b = new Budget(runtime, Date.now(), 0);
    expect(b.allowCall(0.001, 0, false, false)).toBe(true);
    expect(b.allowCall(0.001, runtime.budget.perTaskLimit, false, false)).toBe('final');
    b.dispose();
  });
  it('soft の締め切りを過ぎたら新しいタスクを始めない', () => {
    let t = 0;
    const b = new Budget(runtime, 0, 0, () => t);
    t = runtime.run.softDeadlineMinutes * 60_000 + 1;
    expect(b.canStartTask(true, false)).toBe('soft-deadline');
    b.dispose();
  });
});

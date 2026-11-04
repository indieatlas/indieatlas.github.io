import type { RuntimeConfig } from '../../schema/config.ts';
import type { NewTask, TaskResult } from '../../schema/proposal.ts';
import type { Task, TaskType } from '../../schema/state.ts';
import { taskId } from '../lib/ids.ts';
import type { RepoData } from '../lib/repo-io.ts';
import { normalizeTitle } from '../lib/text-normalize.ts';
import { normalizeUrl } from '../lib/url-normalize.ts';
import { refreshStatus } from './refresh-status.ts';

/** タスクの ID、優先度、選択、定期的な生成、状態の遷移（04 §4.8.2、06 §6.4） */

const DAY = 86_400_000;

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

/** ISO 週（例: 2026-W45） */
export function isoWeek(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week =
    1 + Math.round(((d.getTime() - firstThursday.getTime()) / DAY - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** タスクの種類ごとの targetKey（04 §4.8.2）。week は、週ごとのタスクの ISO 週 */
export function targetKey(type: TaskType, target: Task['target'], week?: string): string {
  switch (type) {
    case 'process-article':
      return target.url ? normalizeUrl(target.url) : (target.articleId ?? '');
    case 'register-game': {
      const strong = target.hints?.find((h) => /^(steam|itch|official):/.test(h));
      if (strong) return strong;
      return `${normalizeTitle(target.name ?? '')}|${target.hints?.[0] ?? target.url ?? ''}`;
    }
    case 'discover':
    case 'register-event':
      return `${target.sourceId ?? (target.url ? normalizeUrl(target.url) : '')}|${week ?? ''}`;
    case 'check-event':
      return target.eventId ?? (target.url ? normalizeUrl(target.url) : '');
    case 'check-change':
    case 'refresh-game':
    case 'improve-relations':
      return target.gameId ?? '';
    case 'fill-missing':
      return `${target.gameId ?? ''}|${target.field ?? ''}`;
    case 'fix-conflict':
      return `${target.gameId ?? ''}|${target.field ?? ''}|${(target.hints ?? []).find((h) => h.startsWith('scope:')) ?? ''}`;
    case 'fix-duplicate':
      return [target.gameId ?? '', ...(target.hints ?? []).filter((h) => /^g_\d{6}$/.test(h))].sort().join('|');
    case 'fix-reported-error':
      return target.hints?.[0] ?? '';
    case 'improve-collection':
      return target.collectionId ?? `new|${week ?? ''}`;
    case 'review-tags':
      return week ?? '';
  }
}

export function makeTask(
  type: TaskType,
  target: Task['target'],
  goal: string,
  createdBy: Task['createdBy'],
  at: string,
  week?: string,
): Task {
  return {
    id: taskId(type, targetKey(type, target, week)),
    type,
    target,
    goal,
    status: 'open',
    priority: 0,
    attempts: 0,
    createdAt: at,
    createdBy,
  };
}

export function fromNewTask(t: NewTask, createdBy: Task['createdBy'], at: string, today: string): Task {
  return makeTask(t.type, t.target, t.goal, createdBy, at, isoWeek(today));
}

// ------------------------------------------------------------------ 優先度と選択（06 §6.4.2、§6.4.3）

export const TIER_BASE: Record<TaskType, number> = {
  'fix-conflict': 1000,
  'fix-duplicate': 1000,
  'fix-reported-error': 1000,
  'check-change': 800,
  'check-event': 800,
  'process-article': 750,
  'register-game': 600,
  'register-event': 600,
  discover: 600,
  'fill-missing': 400,
  'refresh-game': 350,
  'improve-relations': 200,
  'improve-collection': 200,
  'review-tags': 150,
};
const STAGE1: TaskType[] = ['fix-conflict', 'fix-duplicate', 'fix-reported-error'];

export interface PriorityContext {
  today: string;
  articleCount(gameId: string): number;
  releaseWithinDays(gameId: string, days: number): boolean;
  itemPublishedAt(task: Task): string | undefined;
  lowCoverage: number;
}

export function priorityContext(repo: RepoData, today: string, publishedAt: Map<string, string>): PriorityContext {
  const counts = new Map<string, number>();
  for (const a of repo.articles) for (const g of a.games) counts.set(g.gameId, (counts.get(g.gameId) ?? 0) + 1);
  const upcoming = new Map<string, string>();
  for (const r of refreshStatus(repo, today).releases) {
    const d = r.releases
      .map((x) => x.date?.slice(0, 10))
      .filter((x): x is string => !!x)
      .sort()[0];
    if (d) upcoming.set(r.gameId, d);
  }
  return {
    today,
    articleCount: (id) => counts.get(id) ?? 0,
    releaseWithinDays: (id, days) => {
      const d = upcoming.get(id);
      return !!d && d >= today && d <= addDays(today, days);
    },
    itemPublishedAt: (t) => (t.target.url ? publishedAt.get(normalizeUrl(t.target.url)) : undefined),
    lowCoverage: repo.runtime.exploration.lowCoverageArticleThreshold,
  };
}

function ageDays(from: string, today: string): number {
  return Math.max(0, (Date.parse(`${today}T00:00:00Z`) - Date.parse(from)) / DAY);
}

export function priority(task: Task, ctx: PriorityContext): number {
  let bonus = Math.min(ageDays(task.createdAt, ctx.today), 30) * 2;
  const gameId = task.target.gameId;
  if (gameId && ctx.articleCount(gameId) <= ctx.lowCoverage) bonus += 60;
  if (task.type === 'check-change' && gameId && ctx.releaseWithinDays(gameId, 30)) bonus += 80;
  if (task.type === 'process-article') {
    const p = ctx.itemPublishedAt(task);
    if (p && ageDays(p, ctx.today) <= 3) bonus += 40;
  }
  bonus = Math.min(bonus, 150); // 加点で段階の順序が入れ替わらないよう上限を設ける
  return Math.round((TIER_BASE[task.type] + bonus - task.attempts * 50) * 100) / 100;
}

export function isExploration(task: Task, ctx: PriorityContext, discoverSources: Set<string>): boolean {
  if (task.type === 'discover') return true;
  if (task.type === 'register-game' && task.target.sourceId && discoverSources.has(task.target.sourceId)) return true;
  if ((task.type === 'fill-missing' || task.type === 'check-change') && task.target.gameId) {
    return ctx.articleCount(task.target.gameId) <= ctx.lowCoverage;
  }
  return false;
}

export interface Selection {
  selected: Task[]; // 実行の順
  exploration: Set<string>;
  candidates: Task[]; // 計画（LLM）に渡す上位の候補
}

/** baseline の選択（06 §6.4.3）。LLM を使わない */
export function selectBaseline(
  tasks: Task[],
  runtime: RuntimeConfig,
  ctx: PriorityContext,
  discoverSources: Set<string>,
  maxTasks = runtime.run.maxTasks,
): Selection {
  const open = tasks
    .filter((t) => t.status === 'open' && !(t.recheck?.after && t.recheck.after > ctx.today))
    .map((t) => ({ ...t, priority: priority(t, ctx) }))
    .sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1));
  const slots = maxTasks;
  const explorationSlots = Math.ceil(slots * runtime.exploration.minTaskShare);
  const chosen: Task[] = [];
  const perGame = new Map<string, number>();
  let articles = 0;
  const fits = (t: Task) => {
    if (chosen.includes(t)) return false;
    const g = t.target.gameId;
    if (g && (perGame.get(g) ?? 0) >= runtime.run.maxTasksPerGame) return false;
    if (t.type === 'process-article' && articles >= runtime.limits.maxNewArticles) return false;
    return true;
  };
  const take = (t: Task) => {
    chosen.push(t);
    if (t.target.gameId) perGame.set(t.target.gameId, (perGame.get(t.target.gameId) ?? 0) + 1);
    if (t.type === 'process-article') articles++;
  };
  const exploration = new Set<string>();
  // 3. 段階1（修正）を枠の半分まで
  for (const t of open.filter((x) => STAGE1.includes(x.type))) {
    if (chosen.length >= Math.floor(slots / 2)) break;
    if (fits(t)) take(t);
  }
  // 4. 探索の枠
  for (const t of open.filter((x) => isExploration(x, ctx, discoverSources))) {
    if (exploration.size >= explorationSlots || chosen.length >= slots) break;
    if (fits(t)) {
      take(t);
      exploration.add(t.id);
    }
  }
  // 5. 残りを優先度の順に（段階1は手順3の上限を超えて入れない）
  for (const t of open.filter((x) => !STAGE1.includes(x.type))) {
    if (chosen.length >= slots) break;
    if (fits(t)) take(t);
  }
  return { selected: orderForExecution(chosen, exploration), exploration, candidates: open.slice(0, 40) };
}

/** 実行の順番: 段階1を最大2件 → 探索を1件 → 残りを優先度の順 */
export function orderForExecution(tasks: Task[], exploration: Set<string>): Task[] {
  const rest = [...tasks];
  const out: Task[] = [];
  const pull = (pred: (t: Task) => boolean, n: number) => {
    for (let i = 0; i < rest.length && n > 0;) {
      if (pred(rest[i]!)) {
        out.push(...rest.splice(i, 1));
        n--;
      } else i++;
    }
  };
  pull((t) => STAGE1.includes(t.type), 2);
  pull((t) => exploration.has(t.id), 1);
  out.push(...rest);
  return out;
}

// ------------------------------------------------------------------ 定期的なタスク（R1、06 §6.4.1）

export interface ScheduleResult {
  newTasks: Task[];
  reopened: string[];
}

export function scheduleTasks(repo: RepoData, today: string, at: string): ScheduleResult {
  const existing = new Map(repo.tasks.tasks.map((t) => [t.id, t]));
  const out: Task[] = [];
  // 終わった同じ ID のタスクは、renewDays を過ぎていれば作り直す（採用ジョブが置き換える）
  const add = (t: Task, renewDays = Infinity): boolean => {
    if (out.some((x) => x.id === t.id)) return false;
    const prev = existing.get(t.id);
    if (prev) {
      const doneAt = prev.resolution?.at.slice(0, 10);
      if (prev.status !== 'done' || !doneAt || doneAt > addDays(today, -renewDays)) return false;
    }
    out.push(t);
    return true;
  };
  const week = isoWeek(today);
  const status = refreshStatus(repo, today);
  const published = repo.games.filter((g) => g.status === 'published');

  // check-change: 予定日の過ぎた発売予定、30日以内の発売予定（Steam の作品は採用ジョブがストアから取り直す）
  let n = 0;
  for (const r of status.releases) {
    if (n >= 5) break;
    if (r.gameStatus !== 'published' || r.reason === 'early-access') continue;
    // Steam の機種だけの予定は、採用ジョブがストアの情報から取り直す（LLM を使わない）
    if (r.steamAppId && r.releases.every((x) => ['pc', 'mac', 'linux'].includes(x.platform ?? ''))) continue;
    const near = r.releases.some((x) => x.date && x.date.slice(0, 10) <= addDays(today, 30));
    if (r.reason !== 'date-passed' && !near) continue;
    add(
      makeTask(
        'check-change',
        { gameId: r.gameId, field: 'release' },
        `${r.title} の発売情報（発売日、延期、機種の追加）が変わっていないかを、公式の告知とストアで確かめる`,
        'scheduler',
        at,
      ),
      7,
    ) && n++;
  }

  // fill-missing: 公開中で紹介文のない作品と、候補のまま紹介文がなく公開できない作品
  n = 0;
  for (const g of repo.games.filter((x) => x.status === 'published' || x.status === 'candidate')) {
    if (n >= 5) break;
    const claims = repo.claims.get(g.id)?.claims ?? [];
    if (claims.some((c) => c.field === 'summary' && c.status === 'adopted')) continue;
    add(
      makeTask(
        'fill-missing',
        { gameId: g.id, field: 'summary' },
        `${g.title.display} の紹介文（summary）とタグを、ストアや公式サイトの作品紹介を根拠に書く`,
        'scheduler',
        at,
      ),
      14,
    ) && n++;
  }

  // check-event と register-event（06 §6.13.1）
  n = 0;
  for (const e of status.events) {
    if (n >= 5) break;
    add(
      makeTask(
        'check-event',
        { eventId: e.eventId, url: e.url, name: e.name.slice(0, 120) },
        e.reasons.includes('ended-no-next')
          ? `${e.name} の次の回の告知を主催者のページで探し、あれば催しとして登録する`
          : `${e.name} の日程、時間、会場、状態（中止など）が変わっていないかを案内のページで確かめる`,
        'scheduler',
        at,
      ),
      6,
    ) && n++;
  }
  for (const s of repo.sources.sources.filter(
    (x) => x.enabled && x.kind === 'event' && x.rights.allowFetch && x.fetch.url,
  )) {
    add(
      makeTask(
        'register-event',
        { sourceId: s.id, url: s.fetch.url! },
        `${s.name} の一覧のページから、まだ登録していない催しの日程を登録する`,
        'scheduler',
        at,
        week,
      ),
    );
  }

  // improve-collection: どのコレクションにも入っていない公開中の作品があれば、公開中のコレクションごとに週1回
  if (status.gamesWithoutCollection.length > 0) {
    n = 0;
    for (const c of repo.collections.filter((x) => x.status === 'published')) {
      if (n >= 2) break;
      const t = makeTask(
        'improve-collection',
        { collectionId: c.id },
        `コレクション「${c.title}」の選定条件に合う公開中の作品を、候補から加える`,
        'scheduler',
        at,
      );
      if (add(t, 6)) n++;
    }
  }

  // improve-relations: 関係がなく、タグが3件以上ある作品
  const related = new Set(repo.relations.relations.flatMap((r) => [r.a, r.b]));
  n = 0;
  for (const g of published) {
    if (n >= 3) break;
    if (related.has(g.id)) continue;
    const tags = (repo.claims.get(g.id)?.claims ?? []).filter((c) => c.field === 'tag' && c.status === 'adopted');
    if (tags.length < 3) continue;
    if (
      add(
        makeTask(
          'improve-relations',
          { gameId: g.id },
          `${g.title.display} と遊び方の近い収録作品を、タグと記事を根拠に結ぶ`,
          'scheduler',
          at,
        ),
        30,
      )
    )
      n++;
  }

  // blocked で recheck.after を過ぎたタスクを開き直す
  const reopened = repo.tasks.tasks
    .filter((t) => t.status === 'blocked' && t.recheck?.after && t.recheck.after <= today && t.attempts < 6)
    .map((t) => t.id);
  return { newTasks: out, reopened };
}

// ------------------------------------------------------------------ 状態の遷移（04 §4.8.2）

export function applyOutcome(
  task: Task,
  outcome: TaskResult['outcome'] | 'failed' | 'deferred',
  ctx: { at: string; runId: string; today: string; summary: string; result?: TaskResult },
): Task {
  const t: Task = { ...task, lastAttemptAt: ctx.at, lastRunId: ctx.runId };
  const resolve = (o: typeof outcome): Task => ({
    ...t,
    status: 'done',
    resolution: { at: ctx.at, runId: ctx.runId, outcome: o, summary: ctx.summary.slice(0, 300) },
  });
  delete t.resolution;
  switch (outcome) {
    case 'completed':
    case 'irrelevant':
      return resolve(outcome);
    case 'not-found':
      if (ctx.result?.recheck) {
        return {
          ...t,
          status: 'blocked',
          attempts: t.attempts + 1,
          blockedReason: (ctx.result.blockedReason ?? ctx.summary).slice(0, 300),
          recheck: ctx.result.recheck,
        };
      }
      return resolve(outcome);
    case 'blocked':
      return {
        ...t,
        status: 'blocked',
        attempts: t.attempts + 1,
        blockedReason: (ctx.result?.blockedReason ?? ctx.summary).slice(0, 300),
        recheck: ctx.result?.recheck ?? { after: addDays(ctx.today, 14) },
      };
    case 'partial':
    case 'failed': {
      const attempts = t.attempts + 1;
      if (attempts >= 6) {
        return {
          ...t,
          attempts,
          status: 'dropped',
          resolution: { at: ctx.at, runId: ctx.runId, outcome, summary: ctx.summary.slice(0, 300) },
        };
      }
      if (attempts % 3 === 0) {
        return {
          ...t,
          attempts,
          status: 'blocked',
          blockedReason: ctx.summary.slice(0, 300),
          recheck: { after: addDays(ctx.today, 14) },
        };
      }
      return { ...t, attempts, status: 'open' };
    }
    case 'deferred':
      return { ...task };
  }
}

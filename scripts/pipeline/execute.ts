import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { Operation, TaskResult, ALLOWED_OPERATIONS, type OperationKind } from '../../schema/proposal.ts';
import type { CollectedItem, TaskResultLine } from '../../schema/research-output.ts';
import type { Task, TaskType } from '../../schema/state.ts';
import { adoptedOf, claimsView, matchesRules } from '../lib/claims-view.ts';
import { nowIso } from '../lib/clock.ts';
import { PROJECT_ROOT, type RepoData } from '../lib/repo-io.ts';
import { normalizeUrl } from '../lib/url-normalize.ts';
import { LlmError, type LlmClient, type LlmUsage } from '../llm/client.ts';
import type { Budget } from './budget.ts';
import { matchGames } from './feed-items.ts';
import { createTaskTools, findGames, gameSummary, getGame, type ToolEnv } from './tools.ts';

/** タスクの実行（06 §6.5.3、R5） */

const PROMPT_DIR = path.join(PROJECT_ROOT, 'scripts/llm/prompts');

/** システムプロンプト。実行の間で変わらない部分だけを、決まった順に連結する（06 §6.10） */
export function executeSystemPrompt(repo: RepoData, policy: string): string {
  const read = (f: string) => fs.readFileSync(path.join(PROMPT_DIR, f), 'utf8').trim();
  const tags = repo.tags.tags
    .filter((t) => t.status !== 'deprecated')
    .map((t) => `- ${t.id}: ${t.label.ja}（${t.group}）`)
    .join('\n');
  return [read('base.md'), policy.trim(), read('execute.md'), `# タグの一覧\n\n${tags}`].join('\n\n');
}

export function triageSystemPrompt(policy: string): string {
  const read = (f: string) => fs.readFileSync(path.join(PROMPT_DIR, f), 'utf8').trim();
  return [read('base.md'), policy.trim(), read('triage.md')].join('\n\n');
}

export function planSystemPrompt(policy: string): string {
  const read = (f: string) => fs.readFileSync(path.join(PROMPT_DIR, f), 'utf8').trim();
  return [read('base.md'), policy.trim(), read('plan.md')].join('\n\n');
}

/** submit_result のスキーマを、タスクの種類で使ってよい操作だけに絞る（06 §6.6） */
const resultSchemas = new Map<TaskType, z.ZodType<TaskResult>>();
export function resultSchemaFor(type: TaskType): z.ZodType<TaskResult> {
  let s = resultSchemas.get(type);
  if (!s) {
    const allowed = new Set<OperationKind>(ALLOWED_OPERATIONS[type]);
    const options = Operation.options.filter((o) => allowed.has(o.shape.op.value as OperationKind));
    const ops =
      options.length === 0
        ? z.array(z.never()).max(0)
        : options.length === 1
          ? z.array(options[0]!).max(60)
          : z.array(z.discriminatedUnion('op', options as never)).max(60);
    s = TaskResult.extend({ operations: ops }) as unknown as z.ZodType<TaskResult>;
    resultSchemas.set(type, s);
  }
  return s;
}

function collectionCandidates(repo: RepoData, collectionId: string) {
  const col = repo.collections.find((c) => c.id === collectionId);
  if (!col) return undefined;
  const inside = new Set(col.items.map((i) => i.gameId));
  const candidates = repo.games
    .filter((g) => g.status === 'published' && !inside.has(g.id))
    .filter((g) => matchesRules(claimsView(repo.claims.get(g.id)?.claims ?? []), col.criteria.rules))
    .slice(0, 20)
    .map((g) => {
      const claims = repo.claims.get(g.id)?.claims ?? [];
      const summary = adoptedOf(claims, 'summary')[0];
      return {
        gameId: g.id,
        title: g.title.display,
        summary: summary ? { claimId: summary.id, text: summary.value.ja } : undefined,
        tags: adoptedOf(claims, 'tag').map((t) => ({ claimId: t.id, tagId: t.value.tagId })),
        releases: adoptedOf(claims, 'release').map((r) => ({
          claimId: r.id,
          platform: r.scope.platform,
          status: r.value.status,
        })),
      };
    });
  return {
    collection: {
      id: col.id,
      title: col.title,
      lede: col.lede,
      criteria: col.criteria,
      items: col.items.map((i) => i.gameId),
    },
    candidates,
  };
}

function relationCandidates(repo: RepoData, gameId: string) {
  const tagsOf = (id: string) => adoptedOf(repo.claims.get(id)?.claims ?? [], 'tag');
  const mine = new Set(tagsOf(gameId).map((t) => t.value.tagId));
  return repo.games
    .filter((g) => g.id !== gameId && (g.status === 'published' || g.status === 'candidate'))
    .map((g) => {
      const tags = tagsOf(g.id);
      return { g, tags, shared: tags.filter((t) => mine.has(t.value.tagId)).length };
    })
    .filter((x) => x.shared >= 2)
    .sort((a, b) => b.shared - a.shared || (a.g.id < b.g.id ? -1 : 1))
    .slice(0, 10)
    .map((x) => ({
      ...gameSummary(repo, x.g.id),
      summary: adoptedOf(repo.claims.get(x.g.id)?.claims ?? [], 'summary')[0]?.value.ja,
      tags: x.tags.map((t) => ({ claimId: t.id, tagId: t.value.tagId })),
    }));
}

/** タスクの最初の user メッセージ（毎回変わる部分） */
export function taskPrompt(
  repo: RepoData,
  task: Task,
  today: string,
  extra: { item?: CollectedItem; maxFetches: number },
): string {
  const t = task.target;
  const context: Record<string, unknown> = {};
  if (t.gameId) context.game = getGame(repo, t.gameId);
  if (task.type === 'process-article') {
    if (extra.item)
      context.feedItem = {
        title: extra.item.title,
        description: extra.item.description,
        publishedAt: extra.item.publishedAt,
        sourceId: extra.item.sourceId,
      };
    const names = [...(t.hints ?? []), ...(extra.item ? [extra.item.title] : [])];
    const ids = new Set([
      ...names.flatMap((n) => findGames(repo, n).map((g) => g.gameId)),
      ...(extra.item ? matchGames(repo, extra.item.title) : []),
    ]);
    context.knownGames = [...ids].slice(0, 10).map((id) => gameSummary(repo, id));
  }
  if (task.type === 'register-game' && t.name) context.similarGames = findGames(repo, t.name);
  if (task.type === 'check-event' && t.eventId) {
    const e = repo.events.find((x) => x.id === t.eventId);
    if (e)
      context.event = {
        eventId: e.id,
        name: e.name,
        nameEn: e.nameEn,
        status: e.status,
        kind: e.kind,
        format: e.format,
        start: e.start,
        end: e.end,
        time: e.time,
        location: e.location,
        url: e.url,
        summary: e.summary,
        games: e.games,
      };
  }
  if (task.type === 'register-event' || task.type === 'check-event') {
    context.knownEvents = repo.events
      .filter((e) => e.status !== 'hidden')
      .map((e) => ({ eventId: e.id, name: e.name, start: e.start, url: e.url }))
      .slice(-80);
  }
  if (task.type === 'improve-collection' && t.collectionId)
    Object.assign(context, collectionCandidates(repo, t.collectionId));
  if (task.type === 'improve-relations' && t.gameId) context.candidates = relationCandidates(repo, t.gameId);
  return JSON.stringify({
    today,
    task: { taskId: task.id, type: task.type, goal: task.goal, target: t },
    allowedOperations: ALLOWED_OPERATIONS[task.type],
    limits: {
      maxFetches: extra.maxFetches,
      maxOperations: repo.runtime.limits.maxOperationsPerTask,
      maxFollowUpTasks: repo.runtime.limits.maxFollowUpTasksPerTask,
    },
    context,
  });
}

export interface ExecuteEnv {
  repo: RepoData;
  llm: LlmClient;
  budget: Budget;
  system: string;
  runId: string;
  today: string;
  outDir: string;
  toolEnv: ToolEnv;
  items: Map<string, CollectedItem>; // 正規化した URL → 新着の項目
  onUsage: (u: LlmUsage, sessionId: string, role: 'execute' | 'resolve', taskId: string) => number; // 費用を返す
  estimateRates: { input: number; output: number };
  log: (line: string) => void;
}

export type ExecuteOutcome =
  | { kind: 'result'; line: TaskResultLine }
  | { kind: 'attempt'; outcome: 'failed' | 'deferred'; note: string; stop: string };

export async function executeTask(
  env: ExecuteEnv,
  task: Task,
  exploration: boolean,
  explorationPending: () => boolean,
): Promise<ExecuteOutcome> {
  const role = task.type === 'fix-conflict' ? 'resolve' : 'execute';
  const maxFetches = env.repo.runtime.limits.maxFetchesPerTask;
  const { tools } = createTaskTools(env.toolEnv, task, maxFetches);
  const sessionId = `ia-${env.runId}-${task.id}`;
  let taskSpent = 0;
  const transcriptDir = path.join(env.outDir, 'transcript');
  fs.mkdirSync(transcriptDir, { recursive: true });
  const transcript = path.join(transcriptDir, `${task.id}.jsonl`);
  const item = task.target.url ? env.items.get(normalizeUrl(task.target.url)) : undefined;
  const prompt = taskPrompt(env.repo, task, env.today, { ...(item ? { item } : {}), maxFetches });
  fs.appendFileSync(transcript, JSON.stringify({ prompt }) + '\n');
  try {
    const r = await env.llm.runTools!({
      role,
      sessionId,
      system: env.system,
      prompt,
      tools,
      finalTool: {
        name: 'submit_result',
        description: 'タスクの結果を提出する。最後に必ず1回呼ぶ。',
        schema: resultSchemaFor(task.type),
      },
      maxTurns: env.repo.runtime.llm.maxTurnsPerTask,
      signal: env.budget.signal,
      estimateRates: env.estimateRates,
      beforeTurn: (estimate) => env.budget.allowCall(estimate, taskSpent, exploration, explorationPending()),
      onUsage: (u) => {
        const cost = env.onUsage(u, sessionId, role, task.id);
        taskSpent += cost;
      },
      onTranscript: (e) => fs.appendFileSync(transcript, JSON.stringify(e).slice(0, 200_000) + '\n'),
    });
    if (r.value) {
      const result: TaskResult = { ...r.value, taskId: task.id };
      return {
        kind: 'result',
        line: { taskId: task.id, taskType: task.type, finishedAt: nowIso(), stop: r.stop, costUsd: taskSpent, result },
      };
    }
    const deferred = r.stop === 'budget' || r.stop === 'deadline' || r.stop === 'provider-limit';
    return {
      kind: 'attempt',
      outcome: deferred ? 'deferred' : 'failed',
      note: `${r.stop}${r.error ? `: ${r.error}` : ''}`.slice(0, 300),
      stop: r.stop,
    };
  } catch (e) {
    if (e instanceof LlmError && e.kind === 'auth') throw e;
    const msg = (e as Error).message;
    env.log(`task ${task.id} failed: ${msg}`);
    return { kind: 'attempt', outcome: 'failed', note: msg.slice(0, 300), stop: 'error' };
  }
}

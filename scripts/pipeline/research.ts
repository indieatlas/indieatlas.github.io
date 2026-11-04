import fs from 'node:fs';
import path from 'node:path';
import {
  Collected,
  PlanFile,
  ResearchMeta,
  SourceUpdates,
  TaskResultLine,
  TaskUpdates,
  UsageFile,
  type CollectedItem,
  type UsageEntry,
} from '../../schema/research-output.ts';
import { SourceState, UsageLedger, type Task } from '../../schema/state.ts';
import type { Fetcher } from '../fetch/fetcher.ts';
import type { HttpClient } from '../fetch/http.ts';
import { monthJst, now, toIsoDateTime, toJstDate } from '../lib/clock.ts';
import { readJsonIfExists, repoPath, type RepoData } from '../lib/repo-io.ts';
import { normalizeUrl } from '../lib/url-normalize.ts';
import { LlmError, type LlmClient, type LlmUsage } from '../llm/client.ts';
import { costOf, ratesFor } from '../llm/pricing.ts';
import { Budget } from './budget.ts';
import { collect } from './collect.ts';
import { executeSystemPrompt, executeTask, planSystemPrompt, triageSystemPrompt } from './execute.ts';
import { matchGames } from './feed-items.ts';
import { planTasks } from './plan.ts';
import { fromNewTask, isExploration, makeTask, priorityContext, scheduleTasks, selectBaseline } from './tasks.ts';
import { triageItems } from './triage.ts';
import { readJson } from '../lib/repo-io.ts';
import { RunsFile } from '../../schema/state.ts';
import { listJsonFiles } from '../lib/repo-io.ts';

/** 調査ジョブ（06 §6.1 の R0〜R6）。データは書き換えず、out/ に提案を書く */

export interface ResearchOptions {
  repo: RepoData;
  outDir: string;
  mode: 'full' | 'collect-only';
  runId: string;
  runAttempt: number;
  trigger: ResearchMeta['trigger'];
  triggerCommit: string;
  fetcher: Fetcher;
  steamHttp?: HttpClient;
  llm?: LlmClient;
  llmDisabledReason?: string;
  policy: string;
  maxTasks?: number;
  log?: (line: string) => void;
}

function writeOut(dir: string, name: string, schema: { parse(v: unknown): unknown }, value: unknown): void {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(schema.parse(value), null, 1) + '\n');
}

function monthSpent(month: string): number {
  return readJsonIfExists(UsageLedger, repoPath(`state/usage/${month}.json`))?.totalUsd ?? 0;
}

function previousNotes(): string | undefined {
  // 計画の所見は、実行の記録の pending の先頭に「plan:」で残す
  const files = listJsonFiles(repoPath('state/runs'));
  const last = files.length ? readJson(RunsFile, files[files.length - 1]!).runs.at(-1) : undefined;
  return last?.pending.find((p) => p.startsWith('plan: '))?.slice(6);
}

export async function runResearch(o: ResearchOptions): Promise<ResearchMeta> {
  const log = o.log ?? (() => {});
  const repo = o.repo;
  const runtime = repo.runtime;
  const startedAtDate = now();
  const startedAt = toIsoDateTime(startedAtDate);
  const today = toJstDate(startedAtDate);
  fs.mkdirSync(o.outDir, { recursive: true });
  for (const f of ['task-results.jsonl']) fs.rmSync(path.join(o.outDir, f), { force: true });

  // R0: 予算
  const spentThisMonth = monthSpent(monthJst(startedAtDate));
  // 締め切りは実際の経過時間で測る（INDIEATLAS_NOW で固定した時刻ではなく）
  const budget = new Budget(runtime, Date.now(), spentThisMonth);
  let mode = o.mode;
  let stopReason: ResearchMeta['stopReason'] = 'completed';
  let llm = o.llm;
  if (!llm) {
    mode = 'collect-only';
    stopReason = 'llm-disabled';
    log(`LLM を使わない: ${o.llmDisabledReason ?? 'no client'}`);
  } else if (budget.monthExhausted) {
    mode = 'collect-only';
    stopReason = 'cost-budget';
    llm = undefined;
    log(`今月の予算を使い切った（${spentThisMonth} USD）`);
  }
  const pending: string[] = [];
  const meta = (): ResearchMeta => ({
    schemaVersion: 1,
    runId: o.runId,
    runAttempt: o.runAttempt,
    trigger: o.trigger,
    mode,
    startedAt,
    triggerCommit: o.triggerCommit,
    stopReason,
    pending: pending.slice(0, 20).map((p) => p.slice(0, 200)),
  });
  writeOut(o.outDir, 'meta.json', ResearchMeta, meta());

  // 使用量の記録
  const calls: UsageEntry[] = [];
  const writeUsage = () =>
    writeOut(o.outDir, 'usage.json', UsageFile, {
      schemaVersion: 1,
      calls,
      totalUsd: Math.round(calls.reduce((a, c) => a + c.costUsd, 0) * 1e8) / 1e8,
    });
  const onUsage = (u: LlmUsage, sessionId: string, role: UsageEntry['role'], taskId?: string): number => {
    const cost = costOf(runtime.llm, u);
    if (!(u.model in runtime.llm.pricingUsdPerMTok)) log(`単価表にないモデル: ${u.model}`);
    budget.record(cost);
    calls.push({
      role,
      sessionId: sessionId.slice(0, 200),
      ...(taskId ? { taskId } : {}),
      model: u.model,
      startedAt: u.startedAt,
      inputTokens: Math.max(0, u.promptTokens - u.cachedTokens),
      cachedInputTokens: u.cachedTokens,
      outputTokens: u.completionTokens,
      reasoningTokens: u.reasoningTokens,
      costUsd: cost,
    });
    writeUsage();
    return cost;
  };
  writeUsage();

  // R1: 定期的なタスク
  const scheduled = scheduleTasks(repo, today, startedAt);
  const newTasks: Task[] = [...scheduled.newTasks];
  const tasks = new Map(repo.tasks.tasks.map((t) => [t.id, t]));
  for (const id of scheduled.reopened) tasks.set(id, { ...tasks.get(id)!, status: 'open' });
  for (const t of newTasks) tasks.set(t.id, t);
  log(`R1: 新しいタスク ${newTasks.length}、開き直し ${scheduled.reopened.length}`);

  // R2: collect
  const states = new Map<string, SourceState>();
  for (const s of repo.sources.sources) {
    const st = readJsonIfExists(SourceState, repoPath(`state/sources/${s.id}.json`));
    if (st) states.set(s.id, st);
  }
  const collected = await collect(repo, o.fetcher, states, startedAtDate);
  writeOut(o.outDir, 'source-updates.json', SourceUpdates, { schemaVersion: 1, updates: collected.updates });
  for (const u of collected.updates.filter((x) => !x.ok)) {
    log(`collect ${u.sourceId}: 失敗 ${u.error}`);
    if (u.state.consecutiveFailures >= 5) pending.push(`情報源 ${u.sourceId} の取得が5回続けて失敗した`);
  }
  log(`R2: 新着 ${collected.items.length} 件（${collected.updates.filter((u) => u.ok).length} 情報源）`);

  // R3: triage
  const outlet = (id: string) => repo.sources.sources.find((s) => s.id === id)?.name ?? id;
  const titles = repo.games.filter((g) => g.status === 'published').flatMap((g) => [g.title.display, g.title.original]);
  let items: CollectedItem[] = collected.items;
  if (mode === 'full' && llm) {
    items = await triageItems(llm, collected.items, {
      system: triageSystemPrompt(o.policy),
      runId: o.runId,
      outletName: outlet,
      knownTitles: [...new Set(titles)],
      onUsage: (u, sid) => onUsage(u, sid, 'triage'),
      canCall: () => !budget.hardPassed() && budget.spent < budget.runLimit,
      log,
    });
  }
  for (const item of items) {
    if (item.triage?.relevant === 'no') continue;
    const hints = [...new Set([...(item.triage?.mentionedGames ?? []), ...matchGames(repo, item.title)])]
      .slice(0, 10)
      .map((h) => h.slice(0, 200));
    const t = makeTask(
      'process-article',
      { url: item.url, sourceId: item.sourceId, ...(hints.length ? { hints } : {}) },
      `記事「${item.title.slice(0, 120)}」を読み、扱う作品を関連づける。未収録のインディーの作品なら登録する`,
      'collector',
      startedAt,
    );
    item.taskId = t.id;
    const prev = tasks.get(t.id);
    if (prev && prev.status !== 'done' && prev.status !== 'dropped') continue;
    if (prev) continue; // 一度処理した記事は扱い直さない
    newTasks.push(t);
    tasks.set(t.id, t);
  }
  writeOut(o.outDir, 'collected.json', Collected, { schemaVersion: 1, items });
  const triaged = items.filter((i) => i.triage);
  log(
    `R3: yes ${triaged.filter((i) => i.triage!.relevant === 'yes').length}、maybe ${triaged.filter((i) => i.triage!.relevant === 'maybe').length}、no ${triaged.filter((i) => i.triage!.relevant === 'no').length}`,
  );

  const attempts: TaskUpdates['attempts'] = [];
  const writeTaskUpdates = () =>
    writeOut(o.outDir, 'task-updates.json', TaskUpdates, {
      schemaVersion: 1,
      newTasks,
      reopened: scheduled.reopened,
      attempts,
    });
  writeTaskUpdates();

  if (mode === 'full' && llm) {
    // R4: plan
    const publishedAt = new Map(items.filter((i) => i.publishedAt).map((i) => [normalizeUrl(i.url), i.publishedAt!]));
    const pctx = priorityContext(repo, today, publishedAt);
    const discoverSources = new Set(repo.sources.sources.filter((s) => s.role === 'discover').map((s) => s.id));
    const slots = o.maxTasks ?? runtime.run.maxTasks;
    const baseline = selectBaseline([...tasks.values()], runtime, pctx, discoverSources, slots);
    const counts: Record<string, number> = {};
    for (const t of tasks.values()) if (t.status === 'open') counts[t.type] = (counts[t.type] ?? 0) + 1;
    const plan = await planTasks(llm, baseline, {
      runtime,
      slots,
      system: planSystemPrompt(o.policy),
      runId: o.runId,
      siteState: {
        publishedGames: repo.games.filter((g) => g.status === 'published').length,
        candidateGames: repo.games.filter((g) => g.status === 'candidate').length,
        articles: repo.articles.length,
        openTasksByType: counts,
      },
      ...(previousNotes() ? { previousNotes: previousNotes()! } : {}),
      onUsage: (u, sid) => onUsage(u, sid, 'plan'),
      canCall: () => budget.spent < budget.runLimit,
      log,
    });
    for (const nt of plan.newTasks) {
      const t = fromNewTask(nt, 'planner', startedAt, today);
      if (!tasks.has(t.id)) {
        newTasks.push(t);
        tasks.set(t.id, t);
      }
    }
    if (plan.notes) pending.unshift(`plan: ${plan.notes}`);
    writeOut(o.outDir, 'plan.json', PlanFile, {
      schemaVersion: 1,
      source: plan.source,
      selected: plan.selected.map((t) => ({
        taskId: t.id,
        why: (plan.why.get(t.id) ?? '').slice(0, 120),
        exploration: baseline.exploration.has(t.id),
      })),
      notes: plan.notes.slice(0, 500),
    });
    writeTaskUpdates();
    log(`R4: ${plan.source} で ${plan.selected.length} 件を選んだ`);

    // R5: execute
    const rates = ratesFor(runtime.llm, runtime.llm.roles.execute.model, startedAt);
    let fetchSeq = 0;
    const env = {
      repo,
      llm,
      budget,
      system: executeSystemPrompt(repo, o.policy),
      runId: o.runId,
      today,
      outDir: o.outDir,
      toolEnv: {
        repo,
        fetcher: o.fetcher,
        ...(o.steamHttp ? { steamHttp: o.steamHttp } : {}),
        logDir: path.join(o.outDir, 'fetch-log'),
        nextFetchId: () => `f_${String(++fetchSeq).padStart(4, '0')}`,
      },
      items: new Map(items.map((i) => [normalizeUrl(i.url), i])),
      onUsage: (u: LlmUsage, sid: string, role: 'execute' | 'resolve', taskId: string) => onUsage(u, sid, role, taskId),
      estimateRates: { input: rates.input, output: rates.output },
      log,
    };
    const remaining = [...plan.selected];
    const explorationPending = () =>
      remaining.some((t) => baseline.exploration.has(t.id) || isExploration(t, pctx, discoverSources));
    while (remaining.length) {
      const task = remaining.shift()!;
      const exploration = baseline.exploration.has(task.id);
      const gate = budget.canStartTask(exploration, explorationPending());
      if (gate !== 'ok') {
        // 探索のタスクが残っていれば、探索以外を飛ばして探索に進む
        if (gate === 'cost-budget' && !exploration && explorationPending()) {
          attempts.push({ taskId: task.id, outcome: 'deferred', note: 'exploration reserve' });
          continue;
        }
        stopReason = gate;
        for (const t of [task, ...remaining]) attempts.push({ taskId: t.id, outcome: 'deferred', note: gate });
        break;
      }
      log(`R5: ${task.type} ${task.id} ${task.goal.slice(0, 60)}`);
      let out;
      try {
        out = await executeTask(env, task, exploration, explorationPending);
      } catch (e) {
        if (e instanceof LlmError && e.kind === 'auth') {
          stopReason = 'llm-disabled';
          pending.push(`LLM の認証に失敗した: ${e.message.slice(0, 120)}`);
          for (const t of [task, ...remaining])
            attempts.push({ taskId: t.id, outcome: 'deferred', note: 'llm auth failed' });
          break;
        }
        throw e;
      }
      if (out.kind === 'result') {
        fs.appendFileSync(
          path.join(o.outDir, 'task-results.jsonl'),
          JSON.stringify(TaskResultLine.parse(out.line)) + '\n',
        );
        log(
          `     → ${out.line.result.outcome}（${out.line.result.operations.length} 操作、${out.line.costUsd.toFixed(4)} USD）`,
        );
      } else {
        attempts.push({ taskId: task.id, outcome: out.outcome, note: out.note });
        log(`     → ${out.outcome}: ${out.note}`);
        if (out.stop === 'provider-limit') {
          stopReason = 'provider-limit';
          for (const t of remaining) attempts.push({ taskId: t.id, outcome: 'deferred', note: 'provider-limit' });
          break;
        }
        if (out.stop === 'deadline') {
          stopReason = 'hard-deadline';
          for (const t of remaining) attempts.push({ taskId: t.id, outcome: 'deferred', note: 'hard-deadline' });
          break;
        }
      }
      writeTaskUpdates();
    }
  }
  budget.dispose();
  writeTaskUpdates();
  // R6
  const finished: ResearchMeta = { ...meta(), finishedAt: toIsoDateTime(now()) };
  writeOut(o.outDir, 'meta.json', ResearchMeta, finished);
  log(`R6: ${stopReason}、${calls.length} 回の呼び出し、${calls.reduce((a, c) => a + c.costUsd, 0).toFixed(4)} USD`);
  return finished;
}

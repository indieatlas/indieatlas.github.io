import fs from 'node:fs';
import path from 'node:path';
import type { Collection } from '../../schema/collection.ts';
import { TaskResult } from '../../schema/proposal.ts';
import {
  Collected,
  FetchLogEntry,
  ResearchMeta,
  SourceUpdates,
  TaskResultLine,
  TaskUpdates,
  UsageFile,
} from '../../schema/research-output.ts';
import type { RunSummary, Task, TasksFile } from '../../schema/state.ts';
import type { HttpClient } from '../fetch/http.ts';
import { monthJst } from '../lib/clock.ts';
import { readJsonIfExists, repoPath, fileKind, writeKind, listJsonFiles, type RepoData } from '../lib/repo-io.ts';
import { readJson } from '../lib/repo-io.ts';
import { RunsFile, UsageLedger } from '../../schema/state.ts';
import { applyTaskResult, addTask, createWorkspace, markSeen, type Workspace } from './apply.ts';
import { repointCollections } from './claim-refs.ts';
import { assessIndie, canPublish } from './publish-rules.ts';
import { resolveGameClaims } from './resolve.ts';
import { seedFromSteam } from './seed-steam.ts';
import { addDays, applyOutcome, fromNewTask, makeTask } from './tasks.ts';
import { indexFetchLog } from './validate/evidence.ts';
import { nextNumericId } from '../lib/ids.ts';
import { refreshStatus } from './refresh-status.ts';
import { scopeKey } from '../../schema/claim.ts';
import { canonicalJson } from '../lib/canonical-json.ts';

/** 採用ジョブの手順4〜12（06 §6.11）。ia apply（12）と共用する */

export interface ResearchBundle {
  dir: string;
  meta: ResearchMeta;
  taskUpdates: TaskUpdates;
  collected: Collected;
  sourceUpdates: SourceUpdates;
  results: TaskResultLine[];
  fetchLog: FetchLogEntry[];
  usage: UsageFile;
}

/** 成果物のディレクトリを探す。research-{runId}-{attempt}/ が複数あれば試行番号の最も大きいもの（手順1） */
export function findResearchDir(input: string): string | undefined {
  if (!fs.existsSync(input)) return undefined;
  if (fs.existsSync(path.join(input, 'meta.json'))) return input;
  const dirs = fs
    .readdirSync(input, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^research-\d+-\d+$/.test(d.name))
    .map((d) => d.name)
    .sort((a, b) => Number(a.split('-').pop()) - Number(b.split('-').pop()));
  const last = dirs.pop();
  return last && fs.existsSync(path.join(input, last, 'meta.json')) ? path.join(input, last) : undefined;
}

export function readResearchBundle(dir: string): ResearchBundle {
  const read = <T>(schema: { parse(v: unknown): T }, name: string, fallback: T): T => {
    const f = path.join(dir, name);
    return fs.existsSync(f) ? schema.parse(JSON.parse(fs.readFileSync(f, 'utf8'))) : fallback;
  };
  const results: TaskResultLine[] = [];
  const resultsFile = path.join(dir, 'task-results.jsonl');
  if (fs.existsSync(resultsFile)) {
    for (const line of fs.readFileSync(resultsFile, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      // 途中で異常終了した行（書きかけ）は読み飛ばす
      try {
        const parsed = TaskResultLine.safeParse(JSON.parse(line));
        if (parsed.success) results.push(parsed.data);
      } catch {
        // 読めない行は無視する
      }
    }
  }
  const logDir = path.join(dir, 'fetch-log');
  const fetchLog = fs.existsSync(logDir)
    ? fs
        .readdirSync(logDir)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .flatMap((f) => {
          const r = FetchLogEntry.safeParse(JSON.parse(fs.readFileSync(path.join(logDir, f), 'utf8')));
          return r.success ? [r.data] : [];
        })
    : [];
  return {
    dir,
    meta: ResearchMeta.parse(JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'))),
    taskUpdates: read(TaskUpdates, 'task-updates.json', {
      schemaVersion: 1,
      newTasks: [],
      reopened: [],
      attempts: [],
      expired: [],
    }),
    collected: read(Collected, 'collected.json', { schemaVersion: 1, items: [] }),
    sourceUpdates: read(SourceUpdates, 'source-updates.json', { schemaVersion: 1, updates: [] }),
    results,
    fetchLog,
    usage: read(UsageFile, 'usage.json', { schemaVersion: 1, calls: [], totalUsd: 0 }),
  };
}

/** state/runs/ にこの調査結果がすでに記録されているか（重複適用の防止） */
export function alreadyAdopted(meta: ResearchMeta): boolean {
  for (const f of listJsonFiles(repoPath('state/runs'))) {
    const runs = readJson(RunsFile, f);
    if (runs.runs.some((r) => r.runId === meta.runId && (r.researchAttempt ?? r.runAttempt) === meta.runAttempt))
      return true;
  }
  return false;
}

export interface AdoptOptions {
  at: string;
  today: string;
  runId: string;
  runAttempt: number;
  trigger: RunSummary['trigger'];
  triggerCommit: string;
  /** Steam の作品情報を取り直すのに使う。なければ取り直さない（テスト） */
  steamHttp?: HttpClient;
  /** 1回の実行で Steam から取り直す作品の上限 */
  maxSteamRefresh?: number;
  log?: (line: string) => void;
}

export interface AdoptResult {
  ws: Workspace;
  summary: RunSummary;
  publishedGames: string[];
  tasksArchived: TasksFile['tasks'];
}

function upsertTask(ws: Workspace, t: Task): void {
  const tasks = ws.repo.tasks.tasks;
  const i = tasks.findIndex((x) => x.id === t.id);
  if (i >= 0) tasks[i] = t;
  else tasks.push(t);
  ws.dirty.tasks = true;
}

/** 採用の本体。作業用のデータ（Workspace）を作り、書き込む前の状態で返す */
export async function adoptResearch(
  repo: RepoData,
  bundle: ResearchBundle | undefined,
  o: AdoptOptions,
): Promise<AdoptResult> {
  const log = o.log ?? (() => {});
  const ws = createWorkspace(repo, {
    at: o.at,
    today: o.today,
    runId: bundle?.meta.runId ?? o.runId,
    log: indexFetchLog(bundle?.fetchLog ?? []),
  });
  const tasksBefore = new Map(repo.tasks.tasks.map((t) => [t.id, t]));

  // 4. タスクの更新
  if (bundle) {
    for (const t of bundle.taskUpdates.newTasks) {
      const prev = tasksBefore.get(t.id);
      // 終わったタスクは作り直してよい（定期的なタスクの更新）。未完了のものは重ねない
      if (prev && prev.status !== 'done' && prev.status !== 'dropped') continue;
      upsertTask(ws, t);
    }
    for (const id of bundle.taskUpdates.reopened) {
      const t = ws.repo.tasks.tasks.find((x) => x.id === id);
      if (t?.status === 'blocked') upsertTask(ws, { ...t, status: 'open' });
    }
    for (const id of bundle.taskUpdates.expired) {
      const t = ws.repo.tasks.tasks.find((x) => x.id === id);
      if (t?.status !== 'open') continue;
      upsertTask(ws, {
        ...t,
        status: 'dropped',
        resolution: {
          at: o.at,
          runId: ws.runId,
          outcome: 'deferred',
          summary: '作ってから14日を過ぎた記事なので扱わない',
        },
      });
    }
  }

  // 5. 新着の記録
  for (const item of bundle?.collected.items ?? []) {
    if (item.triage?.relevant === 'no') markSeen(ws, [item.url], { status: 'irrelevant', sourceId: item.sourceId });
    else if (item.taskId) markSeen(ws, [item.url], { status: 'task', taskId: item.taskId, sourceId: item.sourceId });
  }

  // 6〜7. 提案の反映とタスクの状態
  const done = new Set<string>();
  for (const line of bundle?.results ?? []) {
    const task = ws.repo.tasks.tasks.find((t) => t.id === line.taskId);
    if (!task || done.has(task.id)) continue;
    done.add(task.id);
    const result = TaskResult.parse(line.result);
    applyTaskResult(ws, task, result);
    upsertTask(
      ws,
      applyOutcome(task, result.outcome, {
        at: o.at,
        runId: ws.runId,
        today: o.today,
        summary: result.summary,
        result,
      }),
    );
    if (
      task.type === 'process-article' &&
      task.target.url &&
      (result.outcome === 'irrelevant' || result.outcome === 'not-found')
    ) {
      markSeen(ws, [task.target.url], { status: 'irrelevant' });
    }
    for (const nt of result.followUpTasks) {
      if (nt.type === 'register-game' && nt.target.name) {
        // 収録済みの作品の register-game は作らない
        const name = nt.target.name;
        if (
          ws.repo.games.some((g) =>
            [g.title.display, g.title.original, ...g.aliases.map((a) => a.value)].includes(name),
          )
        )
          continue;
      }
      // 同じ目的のタスクがあれば作らない。終わったものも14日たつまでは作り直さない（同じ確認の繰り返しを防ぐ）
      const t = fromNewTask(nt, 'executor', o.at, o.today);
      const prev = ws.repo.tasks.tasks.find((x) => x.id === t.id);
      if (t.id === task.id || (prev && !(prev.resolution && prev.resolution.at.slice(0, 10) < addDays(o.today, -14))))
        continue;
      addTask(ws, t);
    }
  }
  for (const a of bundle?.taskUpdates.attempts ?? []) {
    const task = ws.repo.tasks.tasks.find((t) => t.id === a.taskId);
    if (!task || done.has(task.id)) continue;
    upsertTask(ws, applyOutcome(task, a.outcome, { at: o.at, runId: ws.runId, today: o.today, summary: a.note }));
  }

  // Steam の作品情報の取り込み: 新しく作った作品と、発売の状態が変わりうる作品（LLM を使わない）
  if (o.steamHttp) {
    const status = refreshStatus(ws.repo, o.today);
    // 予定日を過ぎたものは毎回、それ以外は Steam で6日以上確かめていないものだけ
    const steamCheckedAt = (gameId: string) =>
      (ws.repo.claims.get(gameId)?.claims ?? [])
        .filter(
          (c) =>
            c.field === 'release' && c.status === 'adopted' && c.evidence.some((e) => e.originKey === 'store:steam'),
        )
        .map((c) => c.lastCheckedAt)
        .sort()
        .pop();
    const weekAgo = `${addDays(o.today, -6)}T00:00:00Z`;
    const queue = [
      ...ws.steamToRefresh,
      ...status.releases
        .filter((r) => r.steamAppId && r.gameStatus !== 'merged')
        .filter((r) => r.reason === 'date-passed' || (steamCheckedAt(r.gameId) ?? '') < weekAgo)
        .map((r) => r.gameId),
    ];
    let n = 0;
    for (const gameId of [...new Set(queue)]) {
      if (n >= (o.maxSteamRefresh ?? 40)) break;
      const g = ws.repo.games.find((x) => x.id === gameId);
      if (!g?.externalIds.steamAppId || g.status === 'merged') continue;
      n++;
      try {
        const r = await seedFromSteam(o.steamHttp, ws.repo, g.externalIds.steamAppId, {
          createdBy: 'system',
          runId: ws.runId,
        });
        for (const ng of r.games) {
          const i = ws.repo.games.findIndex((x) => x.id === ng.id);
          const cur = ws.repo.games[i];
          // 識別情報は今のものを保ち、付属アプリ（体験版、DLC）が増えたときだけ取り込む
          if (cur && canonicalJson(cur.associatedApps) !== canonicalJson(ng.associatedApps)) {
            ws.repo.games[i] = { ...cur, associatedApps: ng.associatedApps, updatedAt: ng.updatedAt };
            ws.dirty.games.add(ng.id);
          }
        }
        for (const d of r.developers) {
          const i = ws.repo.developers.findIndex((x) => x.id === d.id);
          if (i >= 0) ws.repo.developers[i] = d;
          else ws.repo.developers.push(d);
          ws.dirty.developers.add(d.id);
        }
        if (r.claims) {
          const before = new Set((ws.repo.claims.get(r.gameId)?.claims ?? []).map((c) => c.id));
          ws.repo.claims.set(r.gameId, r.claims);
          const fresh = r.claims.claims.filter((c) => !before.has(c.id)).map((c) => c.id);
          if (fresh.length) {
            if (!ws.newClaimIds.has(r.gameId)) ws.newClaimIds.set(r.gameId, new Set());
            for (const id of fresh) ws.newClaimIds.get(r.gameId)!.add(id);
            ws.counts.claimsAdded += fresh.length;
            ws.dirty.claims.add(r.gameId);
          }
        }
        for (const note of r.notes) log(`steam ${gameId}: ${note}`);
      } catch (e) {
        log(`steam ${gameId}: ${(e as Error).message}`);
      }
    }
  }

  // 8. 採用の計算と、作品単位の後処理（06 §6.8.6）
  let claimsAdopted = 0;
  let claimsConflicted = 0;
  const touched = new Set([...ws.dirty.claims, ...ws.newClaimIds.keys(), ...ws.dirty.games]);
  const publishedGames: string[] = [];
  for (const gameId of [...touched].sort()) {
    const file = ws.repo.claims.get(gameId);
    if (file) {
      const before = new Map(file.claims.map((c) => [c.id, c.status]));
      const r = resolveGameClaims(file.claims, {
        at: o.at,
        tags: ws.repo.tags.tags,
        newIds: ws.newClaimIds.get(gameId) ?? new Set(),
      });
      for (const c of file.claims) {
        if (c.status === 'adopted' && before.get(c.id) !== 'adopted') claimsAdopted++;
        if (c.status === 'conflicted' && before.get(c.id) !== 'conflicted') claimsConflicted++;
      }
      if (r.changed) ws.dirty.claims.add(gameId);
      const game = ws.repo.games.find((g) => g.id === gameId);
      for (const conflict of r.conflicts) {
        addTask(
          ws,
          makeTask(
            'fix-conflict',
            {
              gameId,
              field: conflict.field,
              claimIds: conflict.claimIds.slice(0, 10),
              hints: [`scope:${scopeKey(conflict.scope)}`],
            },
            `${game?.title.display ?? gameId} の ${conflict.field} の矛盾する情報を、新しい公式の根拠で確かめる`,
            'validator',
            o.at,
          ),
        );
      }
    }
    const game = ws.repo.games.find((g) => g.id === gameId);
    if (!game || game.status === 'merged') continue;
    const assessment = assessIndie(game, ws.repo.developers);
    if (assessment !== game.indie.assessment) {
      game.indie.assessment = assessment;
      game.indie.assessedAt = o.at;
      ws.dirty.games.add(game.id);
    }
  }
  // 公開の判定（05 §5.5.1、P-7 はこの実行での上限）
  const allTasks = [...ws.repo.tasks.tasks, ...ws.newTasks];
  for (const game of ws.repo.games
    .filter((g) => g.status === 'candidate' && touched.has(g.id))
    .sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (publishedGames.length >= ws.repo.runtime.limits.maxNewlyPublishedGames) break;
    const r = canPublish(game, ws.repo.claims.get(game.id)?.claims ?? [], allTasks, ws.repo.developers);
    if (!r.ok) {
      log(`candidate ${game.id} ${game.title.display}: ${r.failed.join(', ')}`);
      continue;
    }
    game.status = 'published';
    game.addedAt ??= o.today;
    game.updatedAt = o.at;
    ws.dirty.games.add(game.id);
    publishedGames.push(game.id);
  }
  // published から hidden に移す（05 §5.5.2）: インディーではないことが公式かストアの根拠で分かった
  for (const game of ws.repo.games.filter((g) => g.status === 'published' && touched.has(g.id))) {
    if (game.indie.assessment === 'not-indie') {
      game.status = 'hidden';
      game.statusReason = 'インディーではないことが公式またはストアの根拠で分かった';
      game.updatedAt = o.at;
      ws.dirty.games.add(game.id);
      ws.pending.push(`${game.id} を非公開にした（not-indie）`);
    }
  }

  // 9. レビュー待ちの反映（人が accepted にしたもの）
  for (const item of ws.repo.reviewQueue.items.filter((i) => i.status === 'accepted')) {
    const op = item.operation as Record<string, unknown>;
    if (item.kind === 'collection-publish' && op.op === 'create-collection-draft') {
      const draft = op.draft as Pick<Collection, 'title' | 'lede' | 'description' | 'criteria'>;
      const items = (op.items as { gameId: string; reason: string; evidenceClaimIds: string[] }[]).filter(
        (i) => ws.repo.games.find((g) => g.id === i.gameId)?.status === 'published',
      );
      const id = nextNumericId(
        'collection',
        ws.repo.collections.map((c) => c.id),
      );
      ws.repo.collections.push({
        schemaVersion: 1,
        id,
        status: items.length >= 4 ? 'published' : 'draft',
        ...draft,
        items: items.map((i, n) => ({ ...i, addedAt: o.today, addedBy: 'llm', position: n })),
        order: 'curated',
        featured: false,
        createdBy: 'llm',
        createdAt: o.at,
        updatedAt: o.at,
      });
      ws.dirty.collections.add(id);
    } else if (item.kind === 'developer-independence' && op.op === 'upsert-developer') {
      const ref = op.developer as { developerId?: string; name?: string };
      const d = ws.repo.developers.find((x) => x.id === ref.developerId || x.name.display === ref.name);
      const status = (op.changes as { proposeIndependence?: string }).proposeIndependence;
      if (d && status) {
        d.independence = { ...d.independence, status: status as never, setBy: 'human' };
        d.updatedAt = o.at;
        ws.dirty.developers.add(d.id);
      }
    } else {
      ws.pending.push(`レビュー待ち ${item.id}（${item.kind}）は自動で反映しない。人が PR で反映する`);
      continue;
    }
    item.status = 'applied';
    item.decidedAt ??= o.at;
    ws.dirty.reviewQueue = true;
  }

  // 置き換えられた Claim を参照するコレクションの項目を付け替える
  for (const col of repointCollections(ws.repo, o.at)) {
    const i = ws.repo.collections.findIndex((c) => c.id === col.id);
    ws.repo.collections[i] = col;
    ws.dirty.collections.add(col.id);
  }

  // 新しいタスクを加える
  for (const t of ws.newTasks) upsertTask(ws, t);

  // 11. 整理: 古い seen-urls と、終わってから30日を過ぎたタスク
  const retention = ws.repo.runtime.retention;
  const seenLimit = addDays(o.today, -retention.seenUrlDays);
  for (const [k, e] of Object.entries(ws.repo.seenUrls.entries)) {
    if ((e.status === 'irrelevant' || e.status === 'failed') && e.lastSeenAt < seenLimit) {
      delete ws.repo.seenUrls.entries[k];
      ws.dirty.seenUrls = true;
    }
  }
  const archiveLimit = addDays(o.today, -retention.doneTaskDays);
  const tasksArchived = ws.repo.tasks.tasks.filter(
    (t) =>
      (t.status === 'done' || t.status === 'dropped') && t.resolution && t.resolution.at.slice(0, 10) < archiveLimit,
  );
  if (tasksArchived.length) {
    ws.repo.tasks.tasks = ws.repo.tasks.tasks.filter((t) => !tasksArchived.includes(t));
    ws.dirty.tasks = true;
  }

  // 12. 実行の記録
  const results = bundle?.results ?? [];
  const meta = bundle?.meta;
  const stopReason = meta?.stopReason ?? 'error';
  const tasksAfter = ws.repo.tasks.tasks;
  const summary: RunSummary = {
    runId: ws.runId,
    runAttempt: o.runAttempt,
    ...(meta ? { researchAttempt: meta.runAttempt } : {}),
    trigger: o.trigger,
    mode: meta?.mode ?? 'collect-only',
    startedAt: meta?.startedAt ?? o.at,
    finishedAt: o.at,
    triggerCommit: o.triggerCommit,
    outcome: !meta ? 'failed' : stopReason === 'completed' || stopReason === 'llm-disabled' ? 'success' : 'partial',
    stopReason,
    counts: {
      sourcesFetched: bundle?.sourceUpdates.updates.filter((u) => u.ok).length ?? 0,
      sourcesFailed: bundle?.sourceUpdates.updates.filter((u) => !u.ok).length ?? 0,
      articlesCollected: bundle?.collected.items.length ?? 0,
      articlesLinked: ws.counts.articlesLinked,
      gamesCreated: ws.createdGames.length,
      gamesPublished: publishedGames.length,
      claimsAdded: ws.counts.claimsAdded,
      claimsAdopted,
      claimsConflicted,
      relationsAdded: ws.counts.relationsAdded,
      collectionsChanged: ws.counts.collectionsChanged,
      tasksCreated: tasksAfter.filter((t) => !tasksBefore.has(t.id)).length,
      tasksDone: tasksAfter.filter((t) => t.status === 'done' && tasksBefore.get(t.id)?.status !== 'done').length,
      tasksBlocked: tasksAfter.filter((t) => t.status === 'blocked' && tasksBefore.get(t.id)?.status !== 'blocked')
        .length,
      operationsRejected: [...ws.rejections.values()].reduce((a, b) => a + b, 0),
    },
    cost: {
      llmUsd: Math.round((bundle?.usage.totalUsd ?? 0) * 1e6) / 1e6,
      inputTokens: (bundle?.usage.calls ?? []).reduce((a, c) => a + c.inputTokens + c.cachedInputTokens, 0),
      outputTokens: (bundle?.usage.calls ?? []).reduce((a, c) => a + c.outputTokens, 0),
      cachedInputTokens: (bundle?.usage.calls ?? []).reduce((a, c) => a + c.cachedInputTokens, 0),
      reasoningTokens: (bundle?.usage.calls ?? []).reduce((a, c) => a + c.reasoningTokens, 0),
    },
    publish: { status: 'pending' },
    pending: [
      ...(meta?.pending ?? []),
      ...ws.pending,
      ...(results.length === 0 && meta?.mode === 'full' ? ['実行したタスクがない'] : []),
    ]
      .slice(0, 20)
      .map((p) => p.slice(0, 200)),
    rejections: [...ws.rejections.entries()]
      .sort()
      .map(([rule, count]) => ({ rule, count }))
      .slice(0, 50),
  };
  return { ws, summary, publishedGames, tasksArchived };
}

/** 作業用のデータのうち、変わったものを書き込む */
export function writeWorkspace(r: AdoptResult): void {
  const { ws } = r;
  const repo = ws.repo;
  for (const id of ws.dirty.games) {
    const g = repo.games.find((x) => x.id === id);
    if (g) writeKind(fileKind('game'), repoPath(`data/games/${id}.json`), g);
  }
  for (const id of ws.dirty.claims) {
    const f = repo.claims.get(id);
    if (f) writeKind(fileKind('claims'), repoPath(`data/claims/${id}.json`), f);
  }
  for (const id of ws.dirty.articles) {
    const a = repo.articles.find((x) => x.id === id);
    if (a) writeKind(fileKind('article'), repoPath(`data/articles/${id}.json`), a);
  }
  for (const id of ws.dirty.eventsDeleted) {
    const f = repoPath(`data/events/${id}.json`);
    if (fs.existsSync(f) && !repo.events.some((e) => e.id === id)) fs.rmSync(f);
  }
  for (const id of ws.dirty.events) {
    const e = repo.events.find((x) => x.id === id);
    if (e) writeKind(fileKind('event'), repoPath(`data/events/${id}.json`), e);
  }
  for (const id of ws.dirty.developers) {
    const d = repo.developers.find((x) => x.id === id);
    if (d) writeKind(fileKind('developer'), repoPath(`data/developers/${id}.json`), d);
  }
  for (const id of ws.dirty.collections) {
    const c = repo.collections.find((x) => x.id === id);
    if (c) writeKind(fileKind('collection'), repoPath(`data/collections/${id}.json`), c);
  }
  if (ws.dirty.relations)
    writeKind(fileKind('relations'), repoPath('data/relations/game-relations.json'), repo.relations);
  if (ws.dirty.tags) writeKind(fileKind('tags'), repoPath('data/taxonomy/tags.json'), repo.tags);
  if (ws.dirty.tasks) writeKind(fileKind('tasks'), repoPath('state/tasks.json'), repo.tasks);
  if (ws.dirty.reviewQueue) writeKind(fileKind('review-queue'), repoPath('state/review-queue.json'), repo.reviewQueue);
  if (ws.dirty.seenUrls) writeKind(fileKind('seen-urls'), repoPath('state/seen-urls.json'), repo.seenUrls);
  if (r.tasksArchived.length) {
    const byMonth = new Map<string, typeof r.tasksArchived>();
    for (const t of r.tasksArchived) {
      const m = t.resolution!.at.slice(0, 7);
      byMonth.set(m, [...(byMonth.get(m) ?? []), t]);
    }
    for (const [m, tasks] of byMonth) {
      const f = repoPath(`state/tasks-archive/${m}.json`);
      const prev = readJsonIfExists(fileKind('tasks-archive').schema, f) as TasksFile | undefined;
      const merged = [...(prev?.tasks ?? []).filter((x) => !tasks.some((t) => t.id === x.id)), ...tasks];
      writeKind(fileKind('tasks-archive'), f, { schemaVersion: 1, tasks: merged });
    }
  }
}

/** 処理位置（手順10）、費用の台帳と実行の記録（手順12）を書く。前回までの公開状態を補完する（手順3） */
export function writeRunRecords(
  bundle: ResearchBundle | undefined,
  summary: RunSummary,
  o: { deployed?: { runId: string; builtAt: string } },
): void {
  for (const u of bundle?.sourceUpdates.updates ?? []) {
    writeKind(fileKind('source-state'), repoPath(`state/sources/${u.sourceId}.json`), u.state);
  }
  const month = monthJst(new Date(summary.finishedAt));
  if (summary.cost.llmUsd > 0) {
    const f = repoPath(`state/usage/${month}.json`);
    const ledger = readJsonIfExists(UsageLedger, f) ?? { schemaVersion: 1 as const, month, entries: [], totalUsd: 0 };
    if (
      !ledger.entries.some(
        (e) => e.runId === summary.runId && e.runAttempt === (summary.researchAttempt ?? summary.runAttempt),
      )
    ) {
      ledger.entries.push({
        runId: summary.runId,
        runAttempt: summary.researchAttempt ?? summary.runAttempt,
        at: summary.finishedAt,
        llmUsd: summary.cost.llmUsd,
      });
      ledger.totalUsd = Math.round(ledger.entries.reduce((a, e) => a + e.llmUsd, 0) * 1e6) / 1e6;
      writeKind(fileKind('usage'), f, ledger);
    }
  }
  const f = repoPath(`state/runs/${month}.json`);
  const runs = readJsonIfExists(RunsFile, f) ?? { schemaVersion: 1 as const, runs: [] };
  // 前回までの pending を、公開中の manifest と比べて確定する
  for (const dir of listJsonFiles(repoPath('state/runs'))) {
    const other = dir === f ? runs : readJson(RunsFile, dir);
    let changed = false;
    for (const run of other.runs) {
      if (run.publish.status !== 'pending' || !o.deployed) continue;
      // 公開中のサイトが、この実行の後にビルドされていれば、この実行のデータを含む
      run.publish.status =
        run.runId === o.deployed.runId || o.deployed.builtAt >= run.finishedAt ? 'deployed' : 'unknown';
      changed = true;
    }
    if (changed && dir !== f) writeKind(fileKind('runs'), dir, other);
  }
  runs.runs = [
    ...runs.runs.filter((x) => !(x.runId === summary.runId && x.runAttempt === summary.runAttempt)),
    summary,
  ];
  writeKind(fileKind('runs'), f, runs);
}

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { RunSummary } from '../../schema/state.ts';
import { botUserAgent } from '../fetch/fetcher.ts';
import { createSimpleHttp } from '../fetch/http.ts';
import { now, toIsoDateTime, toJstDate } from '../lib/clock.ts';
import { runMain, UserError } from '../lib/errors.ts';
import { loadRepo, PROJECT_ROOT } from '../lib/repo-io.ts';
import {
  adoptResearch,
  alreadyAdopted,
  findResearchDir,
  readResearchBundle,
  writeRunRecords,
  writeWorkspace,
} from '../pipeline/adopt-core.ts';
import { checkData } from '../pipeline/data-checks.ts';

// 採用ジョブ（06 §6.11）。調査結果を検証して data/ と state/ に反映し、コミットする
//   npm run adopt -- --in out/research [--push] [--dry-run]
const ALLOWED = [/^data\//, /^state\//, /^public\/media\//]; // V-P01

const gitRaw = (...args: string[]) => execFileSync('git', args, { cwd: PROJECT_ROOT, encoding: 'utf8' });
const git = (...args: string[]) => gitRaw(...args).trim();

function changedPaths(): string[] {
  return gitRaw('status', '--porcelain', '--untracked-files=all')
    .split('\n')
    .filter(Boolean)
    .map((l) => l.slice(3).replace(/^"|"$/g, '').split(' -> ').pop()!);
}

function restore(): void {
  git('checkout', '--', 'data', 'state', 'public/media');
  git('clean', '-fdq', '--', 'data', 'state', 'public/media');
}

function output(name: string, value: string): void {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function stepSummary(s: RunSummary, rejections: { rule: string; message: string }[]): string {
  const c = s.counts;
  const lines = [
    `## 採用 ${s.runId}（${s.outcome}、${s.stopReason}）`,
    '',
    `| 項目 | 件数 |`,
    `| - | - |`,
    `| 新着の記事 | ${c.articlesCollected} |`,
    `| 関連づけた記事 | ${c.articlesLinked} |`,
    `| 新しい作品（公開） | ${c.gamesCreated}（${c.gamesPublished}） |`,
    `| Claim（追加 / 採用 / 矛盾） | ${c.claimsAdded} / ${c.claimsAdopted} / ${c.claimsConflicted} |`,
    `| コレクションの変更 | ${c.collectionsChanged} |`,
    `| タスク（作成 / 完了 / 保留） | ${c.tasksCreated} / ${c.tasksDone} / ${c.tasksBlocked} |`,
    `| 却下した操作 | ${c.operationsRejected} |`,
    `| LLM の利用額 | ${s.cost.llmUsd.toFixed(4)} USD |`,
    '',
  ];
  if (s.rejections.length) lines.push(`却下: ${s.rejections.map((r) => `${r.rule} ${r.count}`).join('、')}`, '');
  for (const r of rejections.slice(0, 20)) lines.push(`- ${r.rule}: ${r.message}`);
  if (s.pending.length) lines.push('', '保留:', ...s.pending.map((p) => `- ${p}`));
  return lines.join('\n') + '\n';
}

async function deployedManifest(): Promise<{ runId: string; builtAt: string } | undefined> {
  const site = process.env.SITE_URL;
  if (!site) return undefined;
  try {
    const http = createSimpleHttp({
      userAgent: 'IndieAtlasBot/0.1',
      minIntervalMs: 0,
      timeoutMs: 10_000,
      maxBytes: 1_000_000,
    });
    const res = await http.get(
      `${site.replace(/\/$/, '')}${process.env.BASE_PATH || '/'}build-manifest.json?t=${Date.now()}`,
    );
    if (res.status !== 200) return undefined;
    const m = JSON.parse(res.text) as { runId?: string; builtAt?: string };
    return m.runId && m.builtAt ? { runId: String(m.runId), builtAt: m.builtAt } : undefined;
  } catch {
    return undefined;
  }
}

function runMedia(script: string): void {
  const r = spawnSync('npm', ['run', '--silent', script], { cwd: PROJECT_ROOT, stdio: 'inherit', env: process.env });
  if (r.status !== 0) console.warn(`adopt: npm run ${script} が失敗した（続ける）`);
}

await runMain(async () => {
  const { values } = parseArgs({
    options: {
      in: { type: 'string', default: 'out/research' },
      push: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      'no-media': { type: 'boolean', default: false },
    },
  });
  const dryRun = values['dry-run'];
  if (changedPaths().some((p) => ALLOWED.some((re) => re.test(p)))) {
    throw new UserError('data/、state/、public/media/ に未コミットの変更がある。コミットするか戻してから実行する');
  }
  const dir = findResearchDir(path.resolve(PROJECT_ROOT, values.in!));
  const bundle = dir ? readResearchBundle(dir) : undefined;
  if (!bundle) console.warn(`adopt: 調査結果が見つからない（${values.in}）。前回の公開状態の補完だけを行う`);
  if (bundle && alreadyAdopted(bundle.meta)) {
    console.log(`adopt: ${bundle.meta.runId} の試行 ${bundle.meta.runAttempt} は反映済み`);
    output('data_commit', git('rev-parse', 'HEAD'));
    return;
  }
  const deployed = await deployedManifest();
  const ua = botUserAgent(loadRepo().runtime.fetch.userAgent);
  const steamHttp = createSimpleHttp({ userAgent: ua, minIntervalMs: 1_500, timeoutMs: 20_000, maxBytes: 5_000_000 });

  for (let attempt = 1; attempt <= 3; attempt++) {
    const at = toIsoDateTime(now());
    const repo = loadRepo();
    const result = await adoptResearch(repo, bundle, {
      at,
      today: toJstDate(now()),
      runId: process.env.RUN_ID || bundle?.meta.runId || `local-adopt-${at.slice(0, 10)}`,
      runAttempt: Number(process.env.RUN_ATTEMPT || 1),
      trigger: bundle?.meta.trigger ?? 'local',
      triggerCommit: process.env.TRIGGER_COMMIT || git('rev-parse', 'HEAD'),
      steamHttp,
      log: (l) => console.log(l),
    });
    writeWorkspace(result);
    writeRunRecords(bundle, result.summary, { ...(deployed ? { deployed } : {}) });
    // 新しい記事と催しの画像、新しい作品の色（06 §6.13.3）
    if (!values['no-media']) {
      if (result.ws.newArticles.length) runMedia('media:articles');
      if (result.ws.newEvents.length) runMedia('media:events');
      if (result.ws.dirty.claims.size) runMedia('media:palettes');
      // 終わったばかりの会場の催しの感想（06 §6.13.8。LLM は使わない）
      runMedia('events:reports');
    }
    const s = result.summary;
    console.log(
      `adopt: +${s.counts.gamesCreated} games (${s.counts.gamesPublished} published), +${result.ws.newArticles.length} articles, ${s.counts.claimsAdded} claims, ${s.counts.operationsRejected} rejected`,
    );
    for (const r of result.ws.rejectionLog.slice(0, 40)) console.log(`  ${r.rule} ${r.taskId} ${r.op}: ${r.message}`);
    // 13. 検証
    const issues = checkData();
    if (issues.length) {
      for (const i of issues) console.error(`${i.rule} ${i.file ?? ''}: ${i.message}`);
      restore();
      throw new UserError(`adopt: check:data で ${issues.length} 件の問題。何もコミットしない`);
    }
    if (process.env.GITHUB_STEP_SUMMARY)
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, stepSummary(s, result.ws.rejectionLog));
    // V-P01: 変更は data/、state/、public/media/ の下だけ
    const changed = changedPaths();
    const outside = changed.filter((p) => !ALLOWED.some((re) => re.test(p)));
    if (outside.length) {
      restore();
      throw new UserError(`adopt: V-P01 data/ と state/ 以外が変わった: ${outside.join(', ')}`);
    }
    if (dryRun) {
      console.log(git('diff', '--stat'));
      console.log(`新しいファイル: ${changed.filter((p) => !git('ls-files', p)).length}`);
      restore();
      return;
    }
    if (changed.length === 0) {
      output('data_commit', git('rev-parse', 'HEAD'));
      return;
    }
    git('add', '--', 'data', 'state', 'public/media');
    git(
      'commit',
      '-q',
      '-m',
      `chore(update): run ${s.runId} (+${s.counts.gamesCreated} games, +${result.ws.newArticles.length} articles, ${s.counts.claimsAdopted} claims)`,
    );
    if (!values.push) {
      output('data_commit', git('rev-parse', 'HEAD'));
      return;
    }
    try {
      git('push', 'origin', 'HEAD:main');
      output('data_commit', git('rev-parse', 'HEAD'));
      return;
    } catch (e) {
      // 15. 競合: 強制 push はせず、最新の状態を読み直して再評価する
      console.warn(`adopt: push が拒否された（${attempt}回目）: ${(e as Error).message.split('\n')[0]}`);
      git('fetch', 'origin', 'main');
      git('reset', '--hard', 'origin/main');
    }
  }
  throw new UserError('adopt: 3回とも push に失敗した');
});

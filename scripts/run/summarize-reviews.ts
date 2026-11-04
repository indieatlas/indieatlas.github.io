import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createSimpleHttp } from '../fetch/http.ts';
import { nowIso } from '../lib/clock.ts';
import { runMain } from '../lib/errors.ts';
import { fileKind, loadRepo, PROJECT_ROOT, repoPath, writeKind } from '../lib/repo-io.ts';
import { createOpenAiCompatibleClient } from '../llm/client.ts';
import { meteredLlm, recordUsage, usageRunId } from '../pipeline/usage-ledger.ts';
import { summarizeReviews } from '../pipeline/review-summary.ts';
import {
  appReviewListUrl,
  communityReviewsUrl,
  parseCommunityReviews,
  parseReviewList,
  type SteamReview,
} from '../sources/steam.ts';

// Steam のレビューの要約を作る（06 §6.13.6）。data/metrics/review-summaries.json に書く
//   npm run reviews:summarize [-- --game g_000001] [-- --force]
// OPENCODE_API_KEY がないか、Steam のレビューを取れない環境では何もしない
await runMain(async () => {
  const envFile = path.join(PROJECT_ROOT, '.env');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const { values } = parseArgs({
    options: { game: { type: 'string', multiple: true }, force: { type: 'boolean', default: false } },
  });
  const repo = loadRepo();
  const apiKey = process.env[repo.runtime.llm.apiKeyEnv];
  if (!apiKey) {
    console.log(`reviews:summarize: ${repo.runtime.llm.apiKeyEnv} がないので作らない`);
    return;
  }
  const file = repoPath('data/metrics/review-summaries.json');
  const out = structuredClone(repo.reviewSummaries);
  const http = createSimpleHttp({
    userAgent: 'IndieAtlasBot/0.1',
    minIntervalMs: 1_500,
    timeoutMs: 30_000,
    maxBytes: 5_000_000,
  });
  const roles = repo.runtime.llm.roles;
  // LLM の応答は思考を含めて時間がかかるので、取得とは別に長いタイムアウトにする
  const llmHttp = createSimpleHttp({
    userAgent: 'IndieAtlasBot/0.1',
    minIntervalMs: 0,
    timeoutMs: repo.runtime.llm.requestTimeoutSeconds * 1000,
    maxBytes: 5_000_000,
  });
  const llm = meteredLlm(
    createOpenAiCompatibleClient(llmHttp, {
      baseUrl: repo.runtime.llm.baseUrl,
      apiKey,
      sessionHeader: repo.runtime.llm.sessionHeader,
      userAgent: 'IndieAtlasBot/0.1',
      model: (role) => ({
        model: roles[role].model,
        thinking: roles[role].thinking,
        maxOutputTokens: roles[role].maxOutputTokens,
      }),
    }),
    repo.runtime,
  );
  const at = nowIso();
  const runId = `local-reviews-${at.slice(0, 10)}`;
  let n = 0;
  for (const g of repo.games.filter((x) => x.status === 'published' && x.externalIds.steamAppId)) {
    if (values.game && !values.game.includes(g.id)) continue;
    if (out.entries[g.id] && !values.force) continue;
    const reviews: SteamReview[] = [];
    for (const lang of ['japanese', 'english'] as const) {
      const res = await http.get(appReviewListUrl(g.externalIds.steamAppId!, lang)).catch(() => undefined);
      let list = res?.status === 200 ? parseReviewList(res.text) : undefined;
      // appreviews を取れない環境では、コミュニティのレビューの一覧（「役に立った」順）から取る
      if (!list) {
        list = [];
        for (let page = 1; page <= 3 && list.length < 25; page++) {
          const p = await http.get(communityReviewsUrl(g.externalIds.steamAppId!, lang, page)).catch(() => undefined);
          if (p?.status !== 200) break;
          const more = parseCommunityReviews(p.text, lang);
          if (!more.length) break;
          list.push(...more.filter((r) => !list!.some((x) => x.id === r.id)));
        }
      }
      reviews.push(...list.slice(0, 25).filter((r) => !reviews.some((x) => x.id === r.id)));
    }
    try {
      const r = await summarizeReviews(llm, { id: g.id, title: g.title.display }, reviews, {
        at,
        model: roles.triage.model,
        runId,
      });
      if (r.entry) {
        out.entries[g.id] = r.entry;
        n++;
        console.log(`ok   ${g.id} ${g.title.display}: 長所${r.entry.pros.length} 短所${r.entry.cons.length}`);
      } else console.log(`skip ${g.id} ${g.title.display}: ${r.errors.join(' / ')}`);
    } catch (e) {
      console.log(`fail ${g.id} ${g.title.display}: ${(e as Error).message}`);
    }
    // 途中で止まっても、それまでの結果を残す
    writeKind(fileKind('review-summaries'), file, out);
  }
  writeKind(fileKind('review-summaries'), file, out);
  console.log(`reviews:summarize: ${n} game(s)、${llm.total().toFixed(4)} USD`);
  // 利用額を費用の台帳に足す（毎日の更新と同じ月の上限に数える）
  recordUsage({ ...usageRunId('reviews', at), kind: 'reviews', at, llmUsd: llm.total() });
});

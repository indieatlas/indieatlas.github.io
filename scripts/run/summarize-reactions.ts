import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createSimpleHttp } from '../fetch/http.ts';
import { nowIso } from '../lib/clock.ts';
import { runMain } from '../lib/errors.ts';
import { fileKind, loadRepo, PROJECT_ROOT, repoPath, writeKind } from '../lib/repo-io.ts';
import { createOpenAiCompatibleClient } from '../llm/client.ts';
import { summarizeReactions } from '../pipeline/article-reactions.ts';
import { bookmarkEntryUrl, parseBookmarkEntry, type BookmarkEntry } from '../sources/hatena.ts';

// 記事へのはてなブックマークの反応を要約する（06 §6.13.7）。data/metrics/article-reactions.json に書く
//   npm run reactions:summarize [-- --article a_xxxxxxxxxxxxxxxx] [-- --force]
// 掲載から REFRESH_DAYS 日以内の記事は、ブックマークが増えるので毎回取り直す。
// まだ反応のない記事は MAX_AGE_DAYS 日まで探す（--force ならすべての記事を取り直す）。
// OPENCODE_API_KEY がなければ何もしない
const REFRESH_DAYS = 14;
const MAX_AGE_DAYS = 60;
const DAY = 86_400_000;

await runMain(async () => {
  const envFile = path.join(PROJECT_ROOT, '.env');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const { values } = parseArgs({
    options: { article: { type: 'string', multiple: true }, force: { type: 'boolean', default: false } },
  });
  const repo = loadRepo();
  const apiKey = process.env[repo.runtime.llm.apiKeyEnv];
  if (!apiKey) {
    console.log(`reactions:summarize: ${repo.runtime.llm.apiKeyEnv} がないので作らない`);
    return;
  }
  const file = repoPath('data/metrics/article-reactions.json');
  const out = structuredClone(repo.articleReactions);
  // はてなのサーバーに負荷をかけないよう、1件ずつ間を空ける
  const http = createSimpleHttp({
    userAgent: 'IndieAtlasBot/0.1',
    minIntervalMs: 1_500,
    timeoutMs: 30_000,
    maxBytes: 5_000_000,
  });
  const roles = repo.runtime.llm.roles;
  const llmHttp = createSimpleHttp({
    userAgent: 'IndieAtlasBot/0.1',
    minIntervalMs: 0,
    timeoutMs: repo.runtime.llm.requestTimeoutSeconds * 1000,
    maxBytes: 5_000_000,
  });
  const llm = createOpenAiCompatibleClient(llmHttp, {
    baseUrl: repo.runtime.llm.baseUrl,
    apiKey,
    sessionHeader: repo.runtime.llm.sessionHeader,
    userAgent: 'IndieAtlasBot/0.1',
    model: (role) => ({
      model: roles[role].model,
      thinking: roles[role].thinking,
      maxOutputTokens: roles[role].maxOutputTokens,
    }),
  });
  const at = nowIso();
  const now = Date.parse(at);
  const runId = `local-reactions-${at.slice(0, 10)}`;
  let n = 0;
  for (const a of repo.articles.filter((x) => x.status === 'active')) {
    if (values.article && !values.article.includes(a.id)) continue;
    const published = Date.parse(a.publishedAt ?? a.createdAt);
    const prev = out.entries[a.id];
    if (!values.force && !values.article) {
      if (prev && Date.parse(prev.retrievedAt) - published > REFRESH_DAYS * DAY) continue;
      if (!prev && now - published > MAX_AGE_DAYS * DAY) continue;
    }
    // URL の表記ごとに別のエントリーになるので、いちばんブックマークの多いものを使う
    let best: BookmarkEntry | undefined;
    for (const u of [...new Set([a.canonicalUrl, a.url, ...a.urlAliases])]) {
      const res = await http.get(bookmarkEntryUrl(u)).catch(() => undefined);
      const e = res?.status === 200 ? parseBookmarkEntry(res.text) : undefined;
      if (e && (!best || e.count > best.count)) best = e;
    }
    if (!best) continue;
    try {
      const r = await summarizeReactions(llm, { id: a.id, title: a.title }, best, {
        at,
        model: roles.triage.model,
        runId,
      });
      // 前より悪くなった（要約できなかった）ときは前の要約を残す
      if (prev?.points.length && !r.entry.points.length) out.entries[a.id] = { ...prev, retrievedAt: at };
      else out.entries[a.id] = r.entry;
      if (r.entry.points.length) n++;
      console.log(
        `${r.entry.points.length ? 'ok  ' : 'skip'} ${a.id} はてブ${best.count} コメント${best.comments.length} 反応${r.entry.points.length}` +
          (r.errors.length ? ` (${r.errors.join(' / ')})` : ''),
      );
    } catch (e) {
      console.log(`fail ${a.id}: ${(e as Error).message}`);
    }
    // 途中で止まっても、それまでの結果を残す
    writeKind(fileKind('article-reactions'), file, out);
  }
  writeKind(fileKind('article-reactions'), file, out);
  console.log(`reactions:summarize: ${n} article(s)`);
});

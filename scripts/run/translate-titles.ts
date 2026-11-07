import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { Article } from '../../schema/article.ts';
import { createSimpleHttp } from '../fetch/http.ts';
import { nowIso } from '../lib/clock.ts';
import { runMain } from '../lib/errors.ts';
import { fileKind, loadRepo, PROJECT_ROOT, repoPath, writeKind } from '../lib/repo-io.ts';
import { createOpenAiCompatibleClient } from '../llm/client.ts';
import { TITLE_BATCH, translateTitles } from '../pipeline/title-translation.ts';
import { meteredLlm, recordUsage, usageRunId } from '../pipeline/usage-ledger.ts';

// 日本語以外の記事のうち、タイトルの訳（titleJa）のないものを LLM で訳し、記事のファイルに書く（06 §6.13.9）
//   npm run titles:translate [-- --force]
// OPENCODE_API_KEY がなければ何もしない
await runMain(async () => {
  const envFile = path.join(PROJECT_ROOT, '.env');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const { values } = parseArgs({ options: { force: { type: 'boolean', default: false } } });
  const repo = loadRepo();
  const apiKey = process.env[repo.runtime.llm.apiKeyEnv];
  if (!apiKey) {
    console.log(`titles:translate: ${repo.runtime.llm.apiKeyEnv} がないので訳さない`);
    return;
  }
  const targets = repo.articles.filter((a) => a.status === 'active' && a.lang !== 'ja' && (values.force || !a.titleJa));
  if (!targets.length) {
    console.log('titles:translate: 訳す記事がない');
    return;
  }
  const roles = repo.runtime.llm.roles;
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
  const runId = `local-titles-${at.slice(0, 10)}`;
  let n = 0;
  for (let i = 0; i < targets.length; i += TITLE_BATCH) {
    const batch = targets.slice(i, i + TITLE_BATCH);
    try {
      const r = await translateTitles(
        llm,
        batch.map((a) => ({ id: a.id, title: a.title })),
        { runId, batch: i / TITLE_BATCH + 1 },
      );
      for (const e of r.errors) console.log(`skip ${e}`);
      for (const a of batch) {
        const titleJa = r.translated.get(a.id);
        if (!titleJa) continue;
        // 記事が変わったわけではないので updatedAt は変えない
        writeKind(fileKind('article'), repoPath(`data/articles/${a.id}.json`), Article.parse({ ...a, titleJa }));
        console.log(`ok   ${a.id} ${titleJa}`);
        n++;
      }
    } catch (e) {
      console.log(`fail batch ${i / TITLE_BATCH + 1}: ${(e as Error).message}`);
    }
  }
  console.log(`titles:translate: ${n}/${targets.length} article(s)、${llm.total().toFixed(4)} USD`);
  recordUsage({ ...usageRunId('titles', at), kind: 'titles', at, llmUsd: llm.total() });
});

import { parseArgs } from 'node:util';
import { createSimpleHttp } from '../fetch/http.ts';
import { runMain } from '../lib/errors.ts';
import { loadRepo } from '../lib/repo-io.ts';
import { feedCandidates, parseFeed, type FeedCandidate } from '../pipeline/feed-items.ts';

// 取得してよい媒体のフィードを読み、まだ登録していない新しい記事の候補を JSON で出力する（12 §12.6.7）。データは変えない
//   npm run refresh:feeds [-- --source automaton [--source ...]] [-- --all]
// 既定では、情報源ごとに登録済みの最新の記事より新しい項目だけを出す。--all なら、フィードのすべての項目を出す
await runMain(async () => {
  const { values } = parseArgs({
    options: { source: { type: 'string', multiple: true }, all: { type: 'boolean', default: false } },
  });
  const repo = loadRepo();
  const runtime = repo.runtime;
  const http = createSimpleHttp({
    userAgent: runtime.fetch.userAgent
      .replace('{SITE_URL}', process.env.SITE_URL || 'http://localhost:4321')
      .replace('{BASE_PATH}', process.env.BASE_PATH || '/'),
    minIntervalMs: runtime.fetch.perDomainMinIntervalMs,
    timeoutMs: runtime.fetch.timeoutSeconds * 1000,
    maxBytes: runtime.fetch.maxBytes,
  });
  const sources = repo.sources.sources.filter(
    (s) =>
      s.kind === 'media' &&
      s.rights.allowFetch &&
      s.fetch.url &&
      (s.fetch.method === 'rss' || s.fetch.method === 'atom') &&
      (!values.source || values.source.includes(s.id)),
  );
  const fetched: { sourceId: string; url: string; status: number | 'error'; items: number; error?: string }[] = [];
  const candidates: FeedCandidate[] = [];
  for (const s of sources) {
    const url = s.fetch.url!;
    try {
      const res = await http.get(url);
      if (res.status !== 200) {
        fetched.push({ sourceId: s.id, url, status: res.status, items: 0 });
        continue;
      }
      const items = parseFeed(res.text);
      const latest = values.all
        ? undefined
        : repo.articles
            .filter((a) => a.sourceId === s.id && a.publishedAt)
            .map((a) => a.publishedAt!)
            .sort()
            .pop();
      const fresh = feedCandidates(repo, s.id, items, latest).filter((c) => !c.articleId && !c.seen);
      candidates.push(...fresh);
      fetched.push({ sourceId: s.id, url, status: 200, items: items.length });
    } catch (e) {
      fetched.push({ sourceId: s.id, url, status: 'error', items: 0, error: (e as Error).message });
    }
  }
  // 収録作品の名前を含む候補を先に出す
  candidates.sort(
    (a, b) =>
      Number(b.gameIds.length > 0) - Number(a.gameIds.length > 0) ||
      (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''),
  );
  console.log(JSON.stringify({ fetched, candidates }, null, 2));
});

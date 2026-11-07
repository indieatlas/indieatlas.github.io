import { parseArgs } from 'node:util';
import { EventReportsFile } from '../../schema/event.ts';
import { botUserAgent } from '../fetch/fetcher.ts';
import { createSimpleHttp } from '../fetch/http.ts';
import { now, toIsoDateTime, toJstDate } from '../lib/clock.ts';
import { runMain } from '../lib/errors.ts';
import { fileKind, loadRepo, repoPath, writeKind } from '../lib/repo-io.ts';
import { collectEventReports, fillReportImages, reportTargets } from '../pipeline/event-reports.ts';

// 終わったばかりの会場の催しについて、note と個人のブログの感想と画像を集め、data/event-reports/ に書く（06 §6.13.8）
//   npm run events:reports [-- --event ev_xxx]
await runMain(async () => {
  const { values } = parseArgs({ options: { event: { type: 'string' } } });
  const repo = loadRepo();
  const at = toIsoDateTime(now());
  const targets = values.event
    ? repo.events.filter((e) => e.id === values.event)
    : reportTargets(repo.events, toJstDate(now()));
  if (!targets.length) {
    console.log('events:reports: 感想を探す催しがない');
    return;
  }
  const http = createSimpleHttp({
    userAgent: botUserAgent(repo.runtime.fetch.userAgent),
    // はてなブックマークの robots.txt の Crawl-delay（5秒）に合わせる
    minIntervalMs: Math.max(5_000, repo.runtime.fetch.perDomainMinIntervalMs),
    timeoutMs: repo.runtime.fetch.timeoutSeconds * 1000,
    maxBytes: repo.runtime.fetch.maxBytes,
  });
  const files = new Map(repo.eventReports.map((f) => [f.eventId, f]));
  const known = new Map([...files].map(([id, f]) => [id, new Set(f.reports.map((r) => r.url))]));
  const result = await collectEventReports(http, targets, known, at);
  for (const e of result.errors) console.warn(`warn ${e}`);
  const byEvent = new Map<string, typeof result.added>();
  for (const a of result.added) byEvent.set(a.eventId, [...(byEvent.get(a.eventId) ?? []), a]);
  let images = 0;
  for (const e of targets) {
    const file: EventReportsFile = files.get(e.id) ?? { schemaVersion: 1, eventId: e.id, reports: [] };
    const added = byEvent.get(e.id) ?? [];
    let reports = [...file.reports, ...added.map((a) => a.report)];
    // フィードに画像のなかった感想は、記事のページの OGP 画像で補う
    const filled = new Map((await fillReportImages(http, reports, at)).map((f) => [f.url, f.image]));
    reports = reports.map((r) => (filled.has(r.url) ? { ...r, image: filled.get(r.url)! } : r));
    if (!added.length && !filled.size) continue;
    writeKind(fileKind('event-reports'), repoPath(`data/event-reports/${e.id}.json`), { ...file, reports });
    for (const a of added) console.log(`add  ${e.id} ${a.report.url} ${a.report.title}`);
    console.log(`${e.name}: +${added.length}, ${filled.size} image(s)`);
    images += filled.size;
  }
  console.log(`events:reports: ${targets.length} event(s), +${result.added.length} report(s), ${images} image(s)`);
});

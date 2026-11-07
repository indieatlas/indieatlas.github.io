import { parseArgs } from 'node:util';
import { EventReportsFile } from '../../schema/event.ts';
import { botUserAgent } from '../fetch/fetcher.ts';
import { createSimpleHttp } from '../fetch/http.ts';
import { now, toIsoDateTime, toJstDate } from '../lib/clock.ts';
import { runMain } from '../lib/errors.ts';
import { fileKind, loadRepo, repoPath, writeKind } from '../lib/repo-io.ts';
import { collectEventReports, reportTargets } from '../pipeline/event-reports.ts';

// 終わったばかりの会場の催しについて、note と個人のブログの感想を集め、data/event-reports/ に書く（06 §6.13.8）
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
  for (const [eventId, added] of byEvent) {
    const file: EventReportsFile = files.get(eventId) ?? { schemaVersion: 1, eventId, reports: [] };
    writeKind(fileKind('event-reports'), repoPath(`data/event-reports/${eventId}.json`), {
      ...file,
      reports: [...file.reports, ...added.map((a) => a.report)],
    });
    const name = targets.find((e) => e.id === eventId)?.name;
    for (const a of added) console.log(`add  ${eventId} ${a.report.url} ${a.report.title}`);
    console.log(`${name}: +${added.length}`);
  }
  console.log(`events:reports: ${targets.length} event(s), +${result.added.length} report(s)`);
});

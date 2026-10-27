import type { APIRoute } from 'astro';
import { getEvents, getStats } from '../lib/data.ts';
import { toICalendar } from '../lib/event-calendar.ts';
import { absoluteUrl } from '../lib/urls.ts';

// イベントの iCalendar（カレンダーのアプリで購読できる）。終わったイベントは含めない
export const GET: APIRoute = () => {
  const events = getEvents().filter((e) => e.phase !== 'past');
  // 公開内容が変わらなければ同じファイルになるよう、生成日時ではなくデータの最終更新日を使う
  const stamp = `${(getStats().lastUpdated ?? '2026-01-01').replace(/-/g, '')}T000000Z`;
  return new Response(toICalendar(events, stamp, new URL(absoluteUrl("")).hostname), {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
  });
};

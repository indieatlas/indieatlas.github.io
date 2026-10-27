import type { SiteEvent } from '../../schema/site-data.ts';

// イベントをカレンダーに入れるための形（Google カレンダーの追加用の URL と iCalendar）
const compact = (key: string) => key.replace(/-/g, '');

/** YYYY-MM-DD の翌日（終日の予定の終わりは翌日を指す） */
export function nextDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + 1)).toISOString().slice(0, 10);
}

const isDayPrecision = (e: SiteEvent) => e.start.precision === 'day';

export function googleCalendarUrl(e: SiteEvent): string | undefined {
  if (!isDayPrecision(e)) return undefined;
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.name,
    dates: `${compact(e.startKey)}/${compact(nextDay(e.endKey))}`,
    details: `${e.summary}\n${e.url}`,
    ...(e.location ? { location: [e.location.venue, e.location.city].filter(Boolean).join(' ') } : {}),
  });
  return `https://calendar.google.com/calendar/render?${q}`;
}

const escapeText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

/** 75 オクテットを超える行を折り返す（RFC 5545 §3.1） */
function fold(line: string): string {
  const bytes = new TextEncoder();
  const out: string[] = [];
  let cur = '';
  for (const ch of line) {
    if (bytes.encode(cur + ch).length > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = ch;
    } else cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/** 日まで決まっているイベントの iCalendar。stamp は生成した日時（YYYYMMDDTHHMMSSZ） */
export function toICalendar(events: SiteEvent[], stamp: string, host: string): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Indie Atlas//Events//JA',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Indie Atlas インディーゲームのイベント',
    'X-WR-TIMEZONE:Asia/Tokyo',
  ];
  for (const e of events.filter(isDayPrecision)) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.id}@${host}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(e.startKey)}`,
      `DTEND;VALUE=DATE:${compact(nextDay(e.endKey))}`,
      `SUMMARY:${escapeText(e.name)}`,
      `DESCRIPTION:${escapeText(`${e.time ? `${e.time}\n` : ''}${e.summary}`)}`,
      `URL:${e.url}`,
      ...(e.location ? [`LOCATION:${escapeText([e.location.venue, e.location.city].filter(Boolean).join(' '))}`] : []),
      ...(e.tentative ? ['STATUS:TENTATIVE'] : ['STATUS:CONFIRMED']),
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

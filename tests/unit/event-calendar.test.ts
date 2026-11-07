import { describe, expect, it } from 'vitest';
import type { SiteEvent } from '../../schema/site-data.ts';
import { googleCalendarUrl, nextDay, toICalendar } from '../../src/lib/event-calendar.ts';

// 架空のイベント（10 §10.5.1）
const ev: SiteEvent = {
  id: 'ev_0000000000000001',
  path: 'events/ev_0000000000000001/',
  name: 'ランタン祭り, 2027; 冬',
  kind: 'exhibition',
  format: 'in-person',
  start: { precision: 'day', year: 2027, month: 2, day: 27 },
  end: { precision: 'day', year: 2027, month: 2, day: 28 },
  startKey: '2027-02-27',
  endKey: '2027-02-28',
  dateLabel: '2027年2月27日（土）〜28日（日）',
  location: { venue: '架空ホール', city: '東京都', country: 'JP' },
  url: 'https://lantern.example/fest/',
  summary: '架空のインディーゲームの展示会。',
  tentative: false,
  phase: 'upcoming',
  recentlyEnded: false,
  games: [],
  sources: [],
  articles: [],
  reports: [],
};

describe('イベントのカレンダー', () => {
  it('翌日（月末をまたぐ）', () => {
    expect(nextDay('2027-02-28')).toBe('2027-03-01');
  });
  it('Google カレンダーの URL は終日で、終わりの翌日まで', () => {
    const u = new URL(googleCalendarUrl(ev)!);
    expect(u.searchParams.get('dates')).toBe('20270227/20270301');
    expect(u.searchParams.get('location')).toBe('架空ホール 東京都');
  });
  it('月までしか決まっていないイベントは追加できない', () => {
    expect(googleCalendarUrl({ ...ev, start: { precision: 'month', year: 2027, month: 2 } })).toBeUndefined();
  });
  it('iCalendar は CRLF で区切り、記号をエスケープし、長い行を折り返す', () => {
    const ics = toICalendar([{ ...ev, summary: 'あ'.repeat(60) }], '20261028T000000Z', 'example.org');
    expect(ics).toContain('\r\nDTSTART;VALUE=DATE:20270227\r\n');
    expect(ics).toContain('DTEND;VALUE=DATE:20270301');
    expect(ics).toContain('SUMMARY:ランタン祭り\\, 2027\\; 冬');
    expect(ics).toContain('UID:ev_0000000000000001@example.org');
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});

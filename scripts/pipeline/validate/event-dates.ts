import type { PartialDate } from '../../../schema/common.ts';

/**
 * 根拠の抜粋から日付を読み取る（06 §6.13.1 の V-EV01）。
 * 「2027年3月14日」「3月14日（土）〜15日（日）」「2027/3/14」「March 14-16, 2027」「14 March 2027」などに対応する
 */
export interface QuotedDate {
  year?: number;
  month: number;
  day?: number; // 月だけの表記（「2027年3月」「March 2027」）では省く
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};
const MONTH_NAMES = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join('|');
const RANGE = '\\s*(?:[〜~～\\-–—]|から|to|through)\\s*';

export function datesInText(raw: string): QuotedDate[] {
  const s = raw
    .normalize('NFKC')
    .replace(/\([^)]{1,4}\)/g, ' ')
    .replace(/（[^）]{1,4}）/g, ' ');
  const out: QuotedDate[] = [];
  const push = (y: string | undefined, m: string | number, d?: string) => {
    const month = typeof m === 'number' ? m : Number(m);
    if (month < 1 || month > 12) return;
    const day = d ? Number(d) : undefined;
    if (day !== undefined && (day < 1 || day > 31)) return;
    out.push({ ...(y ? { year: Number(y) } : {}), month, ...(day ? { day } : {}) });
  };
  // 日本語: 2027年3月14日、3月14日〜15日、3月14日〜4月2日
  for (const m of s.matchAll(
    new RegExp(`(?:(\\d{4})年)?\\s*(\\d{1,2})月\\s*(\\d{1,2})日(?:${RANGE}(?:(\\d{1,2})月\\s*)?(\\d{1,2})日)?`, 'g'),
  )) {
    push(m[1], m[2]!, m[3]);
    if (m[5]) push(m[1], m[4] ?? m[2]!, m[5]);
  }
  for (const m of s.matchAll(/(\d{4})年\s*(\d{1,2})月(?!\s*\d{1,2}日)/g)) push(m[1], m[2]!);
  // 数字の区切り: 2027/3/14、2027.03.14、2027-03-14
  for (const m of s.matchAll(/(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/g)) push(m[1], m[2]!, m[3]);
  // 英語: March 14, 2027 / March 14-16, 2027 / Mar 14 – Apr 2, 2027
  const en = new RegExp(
    `\\b(${MONTH_NAMES})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:${RANGE}(?:(${MONTH_NAMES})\\.?\\s+)?(\\d{1,2})(?:st|nd|rd|th)?)?(?:,?\\s+(\\d{4}))?`,
    'gi',
  );
  for (const m of s.matchAll(en)) {
    const m1 = MONTHS[m[1]!.toLowerCase()]!;
    push(m[5], m1, m[2]);
    if (m[4]) push(m[5], m[3] ? MONTHS[m[3].toLowerCase()]! : m1, m[4]);
  }
  // 英語: 14 March 2027 / 14-16 March 2027
  const en2 = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?(?:${RANGE}(\\d{1,2})(?:st|nd|rd|th)?)?\\s+(${MONTH_NAMES})\\.?(?:,?\\s+(\\d{4}))?`,
    'gi',
  );
  for (const m of s.matchAll(en2)) {
    const mo = MONTHS[m[3]!.toLowerCase()]!;
    push(m[4], mo, m[1]);
    if (m[2]) push(m[4], mo, m[2]);
  }
  for (const m of s.matchAll(new RegExp(`\\b(${MONTH_NAMES})\\.?\\s+(\\d{4})\\b`, 'gi')))
    push(m[2], MONTHS[m[1]!.toLowerCase()]!);
  return out;
}

function matches(d: PartialDate, q: QuotedDate): boolean {
  if (q.year !== undefined && q.year !== d.year) return false;
  if (d.precision === 'day') return q.month === d.month && q.day === d.day;
  if (d.precision === 'month') return q.month === d.month;
  return false;
}

/** 開始日と終了日が、抜粋から読み取った日付と一致するか。日と月より粗い精度は年の表記があればよい */
export function eventDatesSupported(start: PartialDate, end: PartialDate | undefined, quotes: string[]): boolean {
  const dates = quotes.flatMap(datesInText);
  const text = quotes.join(' ').normalize('NFKC');
  const ok = (d: PartialDate) =>
    d.precision === 'day' || d.precision === 'month' ? dates.some((q) => matches(d, q)) : text.includes(String(d.year));
  if (!ok(start)) return false;
  return !end || ok(end);
}

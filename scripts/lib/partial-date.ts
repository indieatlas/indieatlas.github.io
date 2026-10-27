import type { PartialDate } from '../../schema/common.ts';

const SEASON_START: Record<string, number> = { spring: 3, summer: 6, autumn: 9, winter: 12 };
const SEASON_LABEL: Record<string, string> = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };

function ymd(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** その期間の最初の日（YYYY-MM-DD）。並び替えに使う */
export function startOf(d: PartialDate): string {
  switch (d.precision) {
    case 'day':
      return ymd(d.year, d.month, d.day);
    case 'month':
      return ymd(d.year, d.month, 1);
    case 'quarter':
      return ymd(d.year, (d.quarter - 1) * 3 + 1, 1);
    case 'half':
      return ymd(d.year, d.half === 1 ? 1 : 7, 1);
    case 'season':
      return ymd(d.year, SEASON_START[d.season]!, 1);
    case 'year':
      return ymd(d.year, 1, 1);
  }
}

/** その期間の最後の日（YYYY-MM-DD）。冬はその年の12月から翌年2月末まで */
export function endOf(d: PartialDate): string {
  switch (d.precision) {
    case 'day':
      return ymd(d.year, d.month, d.day);
    case 'month':
      return ymd(d.year, d.month, lastDayOfMonth(d.year, d.month));
    case 'quarter': {
      const m = d.quarter * 3;
      return ymd(d.year, m, lastDayOfMonth(d.year, m));
    }
    case 'half':
      return d.half === 1 ? ymd(d.year, 6, 30) : ymd(d.year, 12, 31);
    case 'season': {
      if (d.season === 'winter') return ymd(d.year + 1, 2, lastDayOfMonth(d.year + 1, 2));
      const m = SEASON_START[d.season]! + 2;
      return ymd(d.year, m, lastDayOfMonth(d.year, m));
    }
    case 'year':
      return ymd(d.year, 12, 31);
  }
}

/** endOf(d) < today。予定日を過ぎた upcoming を見つけるのに使う */
export function hasPassed(d: PartialDate, today: string): boolean {
  return endOf(d) < today;
}

/** 表示形式（02 §2.4.1） */
export function format(d: PartialDate): string {
  switch (d.precision) {
    case 'day':
      return `${d.year}年${d.month}月${d.day}日`;
    case 'month':
      return `${d.year}年${d.month}月`;
    case 'quarter':
      return `${d.year}年 第${d.quarter}四半期`;
    case 'half':
      return `${d.year}年 ${d.half === 1 ? '上半期' : '下半期'}`;
    case 'season':
      return `${d.year}年 ${SEASON_LABEL[d.season]}`;
    case 'year':
      return `${d.year}年`;
  }
}

/** startOf で比べ、同じなら精度の細かいほうを先にする */
export function compare(a: PartialDate, b: PartialDate): number {
  const sa = startOf(a);
  const sb = startOf(b);
  if (sa !== sb) return sa < sb ? -1 : 1;
  const ea = endOf(a);
  const eb = endOf(b);
  return ea < eb ? -1 : ea > eb ? 1 : 0;
}

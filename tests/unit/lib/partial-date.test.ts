import { describe, expect, it } from 'vitest';
import type { PartialDate } from '../../../schema/common.ts';
import { compare, endOf, format, hasPassed, startOf } from '../../../scripts/lib/partial-date.ts';

const cases: [PartialDate, string, string, string][] = [
  [{ precision: 'day', year: 2026, month: 3, day: 5 }, '2026-03-05', '2026-03-05', '2026年3月5日'],
  [{ precision: 'month', year: 2026, month: 2 }, '2026-02-01', '2026-02-28', '2026年2月'],
  [{ precision: 'month', year: 2028, month: 2 }, '2028-02-01', '2028-02-29', '2028年2月'],
  [{ precision: 'quarter', year: 2027, quarter: 2 }, '2027-04-01', '2027-06-30', '2027年 第2四半期'],
  [{ precision: 'half', year: 2027, half: 1 }, '2027-01-01', '2027-06-30', '2027年 上半期'],
  [{ precision: 'half', year: 2027, half: 2 }, '2027-07-01', '2027-12-31', '2027年 下半期'],
  [{ precision: 'season', year: 2027, season: 'spring' }, '2027-03-01', '2027-05-31', '2027年 春'],
  [{ precision: 'season', year: 2027, season: 'summer' }, '2027-06-01', '2027-08-31', '2027年 夏'],
  [{ precision: 'season', year: 2027, season: 'autumn' }, '2027-09-01', '2027-11-30', '2027年 秋'],
  [{ precision: 'season', year: 2026, season: 'winter' }, '2026-12-01', '2027-02-28', '2026年 冬'],
  [{ precision: 'season', year: 2027, season: 'winter' }, '2027-12-01', '2028-02-29', '2027年 冬'],
  [{ precision: 'year', year: 2027 }, '2027-01-01', '2027-12-31', '2027年'],
];

describe('PartialDate（04 §4.5.4）', () => {
  it.each(cases)('%j', (d, start, end, label) => {
    expect(startOf(d)).toBe(start);
    expect(endOf(d)).toBe(end);
    expect(format(d)).toBe(label);
  });

  it('hasPassed は期間の最後の日を過ぎたときだけ true', () => {
    const winter: PartialDate = { precision: 'season', year: 2026, season: 'winter' };
    expect(hasPassed(winter, '2027-02-28')).toBe(false);
    expect(hasPassed(winter, '2027-03-01')).toBe(true);
    const day: PartialDate = { precision: 'day', year: 2026, month: 10, day: 27 };
    expect(hasPassed(day, '2026-10-27')).toBe(false);
    expect(hasPassed(day, '2026-10-28')).toBe(true);
  });

  it('compare は開始日で比べ、同じなら短い期間を先にする', () => {
    const y: PartialDate = { precision: 'year', year: 2027 };
    const h: PartialDate = { precision: 'half', year: 2027, half: 1 };
    const s: PartialDate = { precision: 'season', year: 2026, season: 'winter' };
    expect([y, h, s].sort(compare)).toEqual([s, h, y]);
  });
});

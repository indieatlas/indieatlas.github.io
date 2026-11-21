import { describe, expect, it } from 'vitest';
import { isLongEvent } from '../../src/lib/events.ts';

const day = (key: string) => {
  const [year, month, d] = key.split('-').map(Number);
  return { precision: 'day' as const, year: year!, month: month!, day: d! };
};
const ev = (startKey: string, endKey: string, withEnd = true) => ({
  startKey,
  endKey,
  ...(withEnd ? { end: day(endKey) } : {}),
});

describe('isLongEvent', () => {
  it('1か月以上続くものは長い', () => {
    expect(isLongEvent(ev('2026-10-16', '2026-11-15'))).toBe(true);
    expect(isLongEvent(ev('2026-07-25', '2027-03-31'))).toBe(true);
  });
  it('1か月に満たないものは長くない', () => {
    expect(isLongEvent(ev('2026-10-16', '2026-11-14'))).toBe(false);
    expect(isLongEvent(ev('2026-11-20', '2026-11-22'))).toBe(false);
  });
  it('終わりの日がなく月しか分からないものは長くない', () => {
    expect(isLongEvent(ev('2027-01-01', '2027-01-31', false))).toBe(false);
  });
});

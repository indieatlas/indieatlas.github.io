import { afterEach, describe, expect, it } from 'vitest';
import { monthJst, now, nowIso, toJstDate } from '../../../scripts/lib/clock.ts';

describe('clock', () => {
  afterEach(() => {
    delete process.env.INDIEATLAS_NOW;
  });

  it('INDIEATLAS_NOW で時刻を固定できる', () => {
    process.env.INDIEATLAS_NOW = '2026-10-27T00:17:05.123Z';
    expect(now().toISOString()).toBe('2026-10-27T00:17:05.123Z');
    expect(nowIso()).toBe('2026-10-27T00:17:05Z');
  });

  it('日本時間の暦日に変換する', () => {
    expect(toJstDate(new Date('2026-10-27T14:59:59Z'))).toBe('2026-10-27');
    expect(toJstDate(new Date('2026-10-27T15:00:00Z'))).toBe('2026-10-28');
    expect(monthJst(new Date('2026-10-31T15:00:00Z'))).toBe('2026-11');
  });

  it('不正な値なら例外を投げる', () => {
    process.env.INDIEATLAS_NOW = 'not-a-date';
    expect(() => now()).toThrow();
  });
});

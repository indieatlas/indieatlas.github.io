import { describe, expect, it } from 'vitest';
import { relativeLabel } from '../../src/scripts/relative-time.ts';

describe('相対的な日時の表示', () => {
  const now = Date.parse('2026-10-28T12:00:00Z');
  it('1時間未満は分、1日未満は時間、7日未満は日', () => {
    expect(relativeLabel('2026-10-28T11:59:50Z', now)).toBe('1分前');
    expect(relativeLabel('2026-10-28T11:15:00Z', now)).toBe('45分前');
    expect(relativeLabel('2026-10-28T02:00:00Z', now)).toBe('10時間前');
    expect(relativeLabel('2026-10-25T12:00:00Z', now)).toBe('3日前');
  });
  it('7日以上前、未来、不正な値は undefined（日付のまま）', () => {
    expect(relativeLabel('2026-10-20T12:00:00Z', now)).toBeUndefined();
    expect(relativeLabel('2026-10-29T12:00:00Z', now)).toBeUndefined();
    expect(relativeLabel('not a date', now)).toBeUndefined();
  });
});

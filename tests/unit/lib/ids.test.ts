import { describe, expect, it } from 'vitest';
import { claimId, nextNumericId, relationId, reviewId, taskId } from '../../../scripts/lib/ids.ts';

describe('ID の規則（04 §4.2.1）', () => {
  it('Claim の ID は scope と value のキーの順番に依存しない', () => {
    const a = claimId(
      'g_000001',
      'release',
      { platform: 'pc', region: 'global' },
      { status: 'released', rawText: 'x' },
    );
    const b = claimId(
      'g_000001',
      'release',
      { region: 'global', platform: 'pc' },
      { rawText: 'x', status: 'released' },
    );
    expect(a).toBe(b);
    expect(a).toMatch(/^c_[0-9a-f]{16}$/);
  });

  it('Claim の ID は値が変われば変わる', () => {
    const a = claimId('g_000001', 'tag', {}, { tagId: 'roguelike' });
    const b = claimId('g_000001', 'tag', {}, { tagId: 'platformer' });
    expect(a).not.toBe(b);
  });

  it('関係の ID は a と b の順番に依存しない', () => {
    expect(relationId('g_000002', 'g_000001', 'same-series')).toBe(relationId('g_000001', 'g_000002', 'same-series'));
    expect(relationId('g_000001', 'g_000002', 'same-series')).toMatch(/^r_[0-9a-f]{16}$/);
  });

  it('タスクとレビュー待ちの ID', () => {
    expect(taskId('check-change', 'g_000001')).toMatch(/^t_[0-9a-f]{16}$/);
    expect(reviewId('merge-games', { b: 1, a: 2 })).toBe(reviewId('merge-games', { a: 2, b: 1 }));
  });

  it('数字の ID は既存の最大値に1を足す（欠番は再利用しない）', () => {
    expect(nextNumericId('game', [])).toBe('g_000001');
    expect(nextNumericId('game', ['g_000001', 'g_000005', 'dev_000009'])).toBe('g_000006');
    expect(nextNumericId('developer', ['dev_000009'])).toBe('dev_000010');
    expect(nextNumericId('collection', ['col_0003'])).toBe('col_0004');
  });
});

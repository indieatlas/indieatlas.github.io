import { describe, expect, it } from 'vitest';
import { gameTheme, themeContrasts } from '../../scripts/build/game-theme.ts';

describe('作品のページの色', () => {
  it.each([['#e8c129'], ['#cd445b'], ['#61d7e6'], ['#2a60ea'], ['#57b0b6'], ['#ad854d']])(
    '%s から作る色は AA のコントラストを満たす',
    (c) => {
      const t = gameTheme([c])!;
      expect(t).toBeDefined();
      for (const [k, v] of Object.entries(themeContrasts(t))) expect(v, k).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('彩度の低い画像では作らない', () => {
    expect(gameTheme(['#777777', '#888888'])).toBeUndefined();
  });

  it('彩度の高い色を優先する', () => {
    const t = gameTheme(['#808080', '#e8173f'])!;
    expect(t.dark['--color-signal']).toMatch(/^#/);
  });
});

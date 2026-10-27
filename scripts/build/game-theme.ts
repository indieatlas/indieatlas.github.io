import { contrast, hexToRgb, hslToHex, rgbToHsl, withContrast } from '../lib/color.ts';

/**
 * 作品の画像の主な色から、作品詳細のページの色（CSS 変数）を作る。
 * 本文と補足の文字、リンク、ボタンの文字が、WCAG 2.2 AA のコントラストを満たすように明るさを調整する。
 * 彩度の低い画像では作らない（既定の色のまま）。
 */
export interface GameTheme {
  dark: Record<string, string>;
  light: Record<string, string>;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function gameTheme(colors: string[]): GameTheme | undefined {
  // 彩度の高い色を優先して選ぶ
  const ranked = colors
    .map((c) => ({ c, hsl: rgbToHsl(hexToRgb(c)) }))
    .sort((a, b) => b.hsl[1] * Math.min(1, b.hsl[2] / 30) - a.hsl[1] * Math.min(1, a.hsl[2] / 30));
  const top = ranked[0];
  if (!top || top.hsl[1] < 18) return undefined;
  const [h, sRaw] = top.hsl;
  const s = clamp(sRaw, 45, 85);
  const white = '#ffffff';

  const dBg = hslToHex(h, clamp(sRaw * 0.45, 12, 32), 6);
  const dSurface = hslToHex(h, clamp(sRaw * 0.35, 10, 26), 9.5);
  const dark = {
    '--color-bg': dBg,
    '--color-bg-deep': hslToHex(h, clamp(sRaw * 0.45, 12, 32), 4),
    '--color-surface': dSurface,
    '--color-surface-raised': hslToHex(h, clamp(sRaw * 0.3, 10, 24), 13.5),
    '--color-border': hslToHex(h, 16, 20),
    '--color-border-strong': hslToHex(h, 14, 31),
    '--color-text-muted': withContrast(h, 14, 66, dSurface, 4.5, 2),
    '--color-accent': withContrast(h, s, 70, dSurface, 4.5, 2),
    '--color-signal': withContrast(h, s, 50, white, 4.5, -2),
    '--color-panel': `color-mix(in srgb, ${dBg} 82%, transparent)`,
  };
  const lBg = hslToHex(h, clamp(sRaw * 0.4, 14, 40), 95);
  const light = {
    '--color-bg': lBg,
    '--color-bg-deep': hslToHex(h, clamp(sRaw * 0.35, 12, 34), 90),
    '--color-surface-raised': hslToHex(h, clamp(sRaw * 0.3, 10, 30), 97),
    '--color-border': hslToHex(h, 18, 85),
    '--color-border-strong': hslToHex(h, 14, 70),
    '--color-text-muted': withContrast(h, 14, 34, lBg, 4.5, -2),
    '--color-accent': withContrast(h, s, 42, lBg, 4.5, -2),
    '--color-signal': withContrast(h, s, 42, white, 4.5, -2),
    '--color-panel': `color-mix(in srgb, ${lBg} 86%, transparent)`,
  };
  return { dark, light };
}

/** テストと確認用: 主要な組み合わせのコントラスト比 */
export function themeContrasts(t: GameTheme): Record<string, number> {
  return {
    'dark.accent/surface': contrast(t.dark['--color-accent']!, t.dark['--color-surface']!),
    'dark.muted/surface': contrast(t.dark['--color-text-muted']!, t.dark['--color-surface']!),
    'dark.white/signal': contrast('#ffffff', t.dark['--color-signal']!),
    'light.accent/bg': contrast(t.light['--color-accent']!, t.light['--color-bg']!),
    'light.muted/bg': contrast(t.light['--color-text-muted']!, t.light['--color-bg']!),
    'light.white/signal': contrast('#ffffff', t.light['--color-signal']!),
  };
}

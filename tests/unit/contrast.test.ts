import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = fs.readFileSync('src/styles/tokens.css', 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  const vars: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) vars[m[1]!] = m[2]!;
  return vars;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1! + 0.05) / (l2! + 0.05);
}

const themes = { dark: block(':root {'), light: block(":root[data-theme='light']") };

// [前景, 背景, 必要な比]（02 §2.5.2: 本文 4.5:1、大きな文字と UI 部品 3:1）
const pairs: [string, string, number][] = [
  ['color-text', 'color-bg', 4.5],
  ['color-text', 'color-surface', 4.5],
  ['color-text', 'color-surface-raised', 4.5],
  ['color-text-muted', 'color-bg', 4.5],
  ['color-text-muted', 'color-surface', 4.5],
  ['color-accent', 'color-bg', 4.5],
  ['color-accent', 'color-surface', 4.5],
  ['color-on-signal', 'color-signal', 4.5],
  ['color-on-warm', 'color-accent-warm', 4.5],
  ['color-unknown', 'color-bg', 4.5],
  ['color-unknown', 'color-surface', 4.5],
  ['color-positive', 'color-surface', 4.5],
  ['color-accent-warm', 'color-bg', 4.5],
  ['color-accent-warm', 'color-surface', 4.5],
  ['color-border-strong', 'color-surface', 1.5],
  ['color-text', 'color-surface-raised', 4.5],
];

describe('文字色のコントラスト比', () => {
  for (const [name, vars] of Object.entries(themes)) {
    it.each(pairs)(`${name}: %s / %s ≥ %d`, (fg, bg, min) => {
      expect(vars[fg], fg).toBeTruthy();
      expect(vars[bg], bg).toBeTruthy();
      expect(contrast(vars[fg]!, vars[bg]!)).toBeGreaterThanOrEqual(min);
    });
  }

  it('ジャンルのカテゴリ色は背景に対して 3:1 以上', () => {
    for (const vars of Object.values(themes)) {
      for (let i = 0; i < 8; i++) expect(contrast(vars[`genre-c${i}`]!, vars['color-bg']!)).toBeGreaterThanOrEqual(3);
    }
  });

  it('ライトテーマの prefers-color-scheme の値は data-theme の値と同じ', () => {
    const media = css.slice(css.indexOf('@media (prefers-color-scheme: light)'));
    const sys = block.call(null, ':root:not([data-theme])');
    expect(media).toContain(':root:not([data-theme])');
    expect(sys).toEqual(themes.light);
  });
});

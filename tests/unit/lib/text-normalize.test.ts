import { describe, expect, it } from 'vitest';
import { kanaVariants, normalizeTitle, toHiragana, toKatakana } from '../../../scripts/lib/text-normalize.ts';

describe('normalizeTitle（04 §4.3.2）', () => {
  it.each([
    ['Lantern Tide', 'lanterntide'],
    ['Ｌａｎｔｅｒｎ　Ｔｉｄｅ', 'lanterntide'],
    ['Lantern Tide™', 'lanterntide'],
    ['Lantern: Tide!', 'lanterntide'],
    ['The Lantern Tide', 'lanterntide'],
    ['Lantern Tide II', 'lanterntide2'],
    ['Lantern Tide IV: Deep', 'lanterntide4deep'],
    ['Salt & Sanctuary', 'saltandsanctuary'],
    ['らんたん・たいど', 'ランタンタイド'],
    ['ランタン・タイド', 'ランタンタイド'],
    ['「星屑のアトリエ」', '星屑ノアトリエ'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeTitle(input)).toBe(expected);
  });

  it('語の一部のローマ数字は変えない', () => {
    expect(normalizeTitle('Vivid Live')).toBe('vividlive');
  });

  it('先頭以外の the は残す', () => {
    expect(normalizeTitle('Into the Breach')).toBe('intothebreach');
  });
});

describe('仮名の変換', () => {
  it('ひらがなとカタカナを相互に変換する', () => {
    expect(toKatakana('らんたん')).toBe('ランタン');
    expect(toHiragana('ランタン')).toBe('らんたん');
  });
  it('kanaVariants は元と異なる表記だけを返す', () => {
    expect(kanaVariants('ランタンタイド')).toEqual(['らんたんたいど']);
    expect(kanaVariants('Lantern')).toEqual([]);
  });
});

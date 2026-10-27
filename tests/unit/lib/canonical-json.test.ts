import { describe, expect, it } from 'vitest';
import { canonicalJson, omitKeysDeep } from '../../../scripts/lib/canonical-json.ts';

describe('canonicalJson', () => {
  it('キーを辞書順に並べる', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
  it('undefined の項目を除く', () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
  it('配列の順番は保つ', () => {
    expect(canonicalJson([3, 1, { z: 1, y: 2 }])).toBe('[3,1,{"y":2,"z":1}]');
  });
  it('キーの順番が違っても同じ文字列になる', () => {
    expect(canonicalJson({ platform: 'pc', region: 'global' })).toBe(
      canonicalJson({ region: 'global', platform: 'pc' }),
    );
  });
});

describe('omitKeysDeep', () => {
  it('どの深さにあってもキーを取り除く', () => {
    expect(omitKeysDeep({ a: 1, checkedAt: 'x', b: [{ checkedAt: 'y', c: 2 }] }, ['checkedAt'])).toEqual({
      a: 1,
      b: [{ c: 2 }],
    });
  });
});

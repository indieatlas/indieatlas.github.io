import { describe, expect, it } from 'vitest';
import {
  normalizeQuery,
  pagefindFilters,
  paramsFromState,
  stateFromParams,
} from '../../src/scripts/search/game-search.ts';

describe('検索の状態と URL', () => {
  it('URL のクエリと状態を相互に変換する', () => {
    const p = new URLSearchParams('q=lantern&tag=roguelike&tag=cozy&platform=switch&sort=released');
    const s = stateFromParams(p);
    expect(s).toEqual({
      q: 'lantern',
      sort: 'released',
      filters: { tag: ['roguelike', 'cozy'], platform: ['switch'], release: [], ja: [], mode: [], fame: [], origin: [] },
    });
    expect(paramsFromState(s).toString()).toBe('q=lantern&tag=roguelike&tag=cozy&platform=switch&sort=released');
  });

  it('不正な並び順は既定にする', () => {
    expect(stateFromParams(new URLSearchParams('sort=evil')).sort).toBe('');
  });

  it('タグはすべてを満たし、その他はいずれかを満たす', () => {
    const s = stateFromParams(new URLSearchParams('tag=a&tag=b&platform=pc&ja=yes'));
    expect(pagefindFilters(s.filters)).toEqual({
      tag: { all: ['a', 'b'] },
      platform: { any: ['pc'] },
      ja: { any: ['yes'] },
    });
  });

  it('全角英数字を揃える', () => {
    expect(normalizeQuery('  Ｌａｎｔｅｒｎ　Ｔｉｄｅ ')).toBe('Lantern Tide');
  });
});

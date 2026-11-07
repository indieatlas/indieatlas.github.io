import { describe, expect, it } from 'vitest';
import type { SiteArticle, SiteGame } from '../../schema/site-data.ts';
import { dailyPicks } from '../../scripts/build/site-data.ts';

// 架空の作品と記事（10 §10.5.1）。選ぶのに使う項目だけを持たせる
const game = (n: number, withArticle = true) =>
  ({
    id: `g_00000${n}`,
    image: { url: `https://img.example/${n}.jpg`, alt: '' },
    summary: { text: '架空の作品の紹介文。', sources: [] },
    articles: withArticle ? [{ id: `a_${n}`, role: 'primary' }] : [],
  }) as unknown as SiteGame;
const article = (n: number, day: string) =>
  ({ id: `a_${n}`, title: `架空の記事 ${n}`, publishedAt: `${day}T00:00:00Z`, games: [] }) as unknown as SiteArticle;

const games = [1, 2, 3, 4, 5, 6, 7].map((n) => game(n)).concat(game(8, false));
const articles = [1, 2, 3, 4, 5, 6, 7].map((n) => article(n, '2026-11-01'));

describe('今日のピックアップ', () => {
  it('同じ日なら同じ作品を選び、記事のない作品は選ばない', () => {
    const a = dailyPicks(games, articles, '2026-11-07');
    expect(dailyPicks(games, articles, '2026-11-07')).toEqual(a);
    expect(a.games).toHaveLength(6);
    expect(a.games.map((p) => p.gameId)).not.toContain('g_000008');
    expect(a.games[0]!.articleIds).toEqual([`a_${a.games[0]!.gameId.slice(-1)}`]);
  });

  it('前の日と同じ作品を続けて先頭にしない', () => {
    const firsts = Array.from({ length: 14 }, (_, i) => {
      const day = new Date(Date.UTC(2026, 10, 1 + i)).toISOString().slice(0, 10);
      return dailyPicks(games, articles, day).games[0]!.gameId;
    });
    for (let i = 1; i < firsts.length; i++) expect(firsts[i]).not.toBe(firsts[i - 1]);
  });
});

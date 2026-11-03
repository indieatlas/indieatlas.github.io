import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadRepo, type RepoData } from '../../scripts/lib/repo-io.ts';
import { feedCandidates, matchGames, parseFeed } from '../../scripts/pipeline/feed-items.ts';

let repo: RepoData;
beforeAll(() => {
  process.env.INDIEATLAS_ROOT = path.resolve('tests/fixtures/repo');
  repo = loadRepo();
});
afterAll(() => {
  delete process.env.INDIEATLAS_ROOT;
});

// 架空の媒体のフィード（10 §10.5.1）
const rss = `<?xml version="1.0"?><rss><channel><title>例</title>
<item><title><![CDATA[『ランタンタイド』の発売日が決定]]></title><link>https://news.example.jp/1</link>
<pubDate>Mon, 02 Nov 2026 10:00:00 +0900</pubDate><category>インディー</category></item>
<item><title>Reportedly a new studio &amp; more</title><link>https://news.example.jp/2</link>
<pubDate>Sun, 01 Nov 2026 10:00:00 +0900</pubDate></item>
<item><title>古い記事</title><link>https://news.example.jp/0</link><pubDate>Sat, 01 Aug 2026 10:00:00 +0900</pubDate></item>
</channel></rss>`;
const rdf = `<rdf:RDF><item rdf:about="https://news.example.jp/3"><title>RDF の記事</title>
<link>https://news.example.jp/3</link><dc:date>2026-11-02T09:00:00+09:00</dc:date><dc:subject>PC</dc:subject></item></rdf:RDF>`;
const atom = `<feed><entry><title>Atom entry</title><link rel="alternate" href="https://news.example.com/4"/>
<published>2026-11-02T00:00:00Z</published><category term="indie"/></entry></feed>`;

describe('フィードの候補（12 §12.6.7）', () => {
  it('RSS 2.0、RSS 1.0、Atom の項目を読む', () => {
    expect(parseFeed(rss)[0]).toEqual({
      title: '『ランタンタイド』の発売日が決定',
      url: 'https://news.example.jp/1',
      publishedAt: '2026-11-02T01:00:00Z',
      categories: ['インディー'],
    });
    expect(parseFeed(rss)[1]!.title).toBe('Reportedly a new studio & more');
    expect(parseFeed(rdf)).toEqual([
      {
        title: 'RDF の記事',
        url: 'https://news.example.jp/3',
        publishedAt: '2026-11-02T00:00:00Z',
        categories: ['PC'],
      },
    ]);
    expect(parseFeed(atom)).toEqual([
      {
        title: 'Atom entry',
        url: 'https://news.example.com/4',
        publishedAt: '2026-11-02T00:00:00Z',
        categories: ['indie'],
      },
    ]);
  });

  it('タイトルから収録作品を見つける。英字の名前は語の一部に当てない', () => {
    expect(matchGames(repo, '『ランタンタイド』の発売日が決定')).toContain('g_000001');
    expect(matchGames(repo, 'Lantern Tide gets a sequel')).toContain('g_000001');
    expect(matchGames(repo, 'Lanterntidesque games we love')).toEqual([]);
  });

  it('前回より新しい項目だけを出し、登録済みの記事に印を付ける', () => {
    const a = repo.articles[0]!;
    const items = [
      ...parseFeed(rss),
      { title: '登録済み', url: a.canonicalUrl, publishedAt: '2026-11-03T00:00:00Z', categories: [] },
    ];
    const c = feedCandidates(repo, 'example', items, '2026-10-01T00:00:00Z');
    expect(c.map((x) => x.url)).toEqual(['https://news.example.jp/1', 'https://news.example.jp/2', a.canonicalUrl]);
    expect(c[2]!.articleId).toBe(a.id);
  });
});

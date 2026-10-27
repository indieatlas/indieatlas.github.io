import { describe, expect, it } from 'vitest';
import { articleId, urlKey } from '../../../scripts/lib/ids.ts';
import { normalizeUrl } from '../../../scripts/lib/url-normalize.ts';

describe('normalizeUrl（04 §4.2.2）', () => {
  it.each([
    ['HTTP://News.Example.JP/a/b/', 'https://news.example.jp/a/b'],
    ['https://www.example.jp/a', 'https://example.jp/a'],
    ['https://m.example.jp/a', 'https://example.jp/a'],
    ['https://amp.example.jp/a', 'https://example.jp/a'],
    ['https://example.jp:443/a', 'https://example.jp/a'],
    ['http://example.jp:80/a', 'https://example.jp/a'],
    ['https://example.jp/a#top', 'https://example.jp/a'],
    ['https://example.jp/a?utm_source=rss&utm_medium=feed', 'https://example.jp/a'],
    ['https://example.jp/a?fbclid=1&gclid=2&ref=x&ref_src=y', 'https://example.jp/a'],
    ['https://example.jp/a?b=2&a=1', 'https://example.jp/a?a=1&b=2'],
    ['https://example.jp/a?output=amp', 'https://example.jp/a'],
    ['https://example.jp//a///b', 'https://example.jp/a/b'],
    ['https://example.jp/a/amp/', 'https://example.jp/a'],
    ['https://example.jp/a/amp', 'https://example.jp/a'],
    ['https://example.jp/', 'https://example.jp/'],
    ['https://example.jp', 'https://example.jp/'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeUrl(input)).toBe(expected);
  });

  it('http(s) 以外は受け付けない', () => {
    expect(() => normalizeUrl('ftp://example.jp/a')).toThrow();
  });
});

describe('記事 ID（受入基準6の前提）', () => {
  const base = 'https://news.example.jp/articles/2026/10/25/lantern-tide-delay';
  it.each([
    `${base}?utm_source=rss`,
    'https://www.news.example.jp/articles/2026/10/25/lantern-tide-delay',
    `${base}/amp/`,
    `${base}/`,
  ])('%s は同じ ID になる', (variant) => {
    expect(articleId(variant)).toBe(articleId(base));
    expect(urlKey(variant)).toBe(urlKey(base));
  });

  it('ID の形式', () => {
    expect(articleId(base)).toMatch(/^a_[0-9a-f]{16}$/);
  });
});

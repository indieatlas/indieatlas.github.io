import { describe, expect, it } from 'vitest';
import { articleImagePath, findOgImage } from '../../scripts/pipeline/article-images.ts';

describe('記事の OGP 画像', () => {
  it('og:image を読む（相対 URL は記事の URL で解決する）', () => {
    const html =
      '<head><meta property="og:image" content="/img/a.jpg?x=1&amp;y=2"><meta name="twitter:image" content="https://cdn.example.com/b.jpg"></head>';
    expect(findOgImage(html, 'https://news.example.jp/articles/1')).toBe('https://news.example.jp/img/a.jpg?x=1&y=2');
  });
  it('og:image がなければ twitter:image を使う', () => {
    expect(
      findOgImage('<meta name="twitter:image" content="https://cdn.example.com/b.jpg">', 'https://example.jp/'),
    ).toBe('https://cdn.example.com/b.jpg');
  });
  it('属性の順番が逆でも読む', () => {
    expect(
      findOgImage('<meta content="https://cdn.example.com/c.png" property="og:image" />', 'https://example.jp/'),
    ).toBe('https://cdn.example.com/c.png');
  });
  it('画像がなければ undefined', () => {
    expect(findOgImage('<meta property="og:title" content="x">', 'https://example.jp/')).toBeUndefined();
  });
  it('保存先は記事 ID の WebP', () => {
    expect(articleImagePath('a_0123456789abcdef')).toBe('media/articles/a_0123456789abcdef.webp');
  });
});

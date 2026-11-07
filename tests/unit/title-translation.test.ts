import { describe, expect, it } from 'vitest';
import { createFakeLlm } from '../../scripts/llm/client.ts';
import type { Article } from '../../schema/article.ts';
import type { TaskResultLine } from '../../schema/research-output.ts';
import {
  applyTitleTranslations,
  pendingTitles,
  titleIssues,
  translateTitles,
} from '../../scripts/pipeline/title-translation.ts';
import { articleHeadline } from '../../src/lib/format.ts';

// 架空の作品の記事（10 §10.5.1）
describe('記事のタイトルの訳（06 §6.13.9）', () => {
  it('訳の問題を見つける', () => {
    const original = 'Lantern Tide gets a release date';
    expect(titleIssues('『Lantern Tide』の発売日が決定', original)).toEqual([]);
    expect(titleIssues('Lantern Tide gets a release date', original)).toContain('日本語でない');
    expect(titleIssues('『Moss Garden』の発売日が決定', original).join()).toMatch(/原文にない英字/);
    expect(titleIssues('発売日が決定 https://example.com', original)).toContain('使わない表現');
  });

  it('訳せたものだけを返す', async () => {
    const llm = createFakeLlm([
      {
        items: [
          { id: 't1', titleJa: '『Lantern Tide』の発売日が決定' },
          { id: 't2', titleJa: 'Moss Garden update' },
        ],
      },
    ]);
    const r = await translateTitles(
      llm,
      [
        { id: 'a_1', title: 'Lantern Tide gets a release date' },
        { id: 'a_2', title: 'Moss Garden update' },
      ],
      { runId: 'test', batch: 1 },
    );
    expect([...r.translated]).toEqual([['a_1', '『Lantern Tide』の発売日が決定']]);
    expect(r.errors).toHaveLength(1);
  });

  it('訳があれば訳を見出しにし、原題と言語の印を添える', () => {
    const outlet = { name: '架空の媒体' };
    expect(
      articleHeadline({ title: 'Lantern Tide out now', titleJa: '『Lantern Tide』発売', lang: 'en', outlet }),
    ).toEqual({
      text: '『Lantern Tide』発売',
      lang: 'ja',
      original: 'Lantern Tide out now',
      foreign: '英語',
    });
    expect(articleHeadline({ title: 'Lantern Tide out now', lang: 'en', outlet })).toEqual({
      text: 'Lantern Tide out now',
      lang: 'en',
      foreign: '英語',
    });
    expect(articleHeadline({ title: '発売', lang: 'ja', outlet })).toEqual({ text: '発売', lang: 'ja' });
  });

  it('調査ジョブが訳すのは、訳のない記事と、この実行で提案した記事', () => {
    const article = (id: string, lang: string, titleJa?: string) =>
      ({
        id,
        url: `https://news.example.com/${id}`,
        canonicalUrl: `https://news.example.com/${id}`,
        urlAliases: [],
        title: `Lantern Tide ${id}`,
        lang,
        status: 'active',
        ...(titleJa ? { titleJa } : {}),
      }) as unknown as Article;
    const articles = [article('a_1', 'en'), article('a_2', 'en', '訳済み'), article('a_3', 'ja')];
    const line = {
      result: {
        operations: [
          {
            op: 'upsert-article',
            article: { url: 'https://news.example.com/new', title: 'Moss Garden out now', lang: 'en' },
          },
          {
            op: 'upsert-article',
            article: { url: 'https://news.example.com/a_1', title: 'Lantern Tide a_1', lang: 'en' },
          },
        ],
      },
    } as unknown as TaskResultLine;
    expect(pendingTitles(articles, [line])).toEqual([
      { articleId: 'a_1', title: 'Lantern Tide a_1' },
      { url: 'https://news.example.com/new', title: 'Moss Garden out now' },
    ]);
    // 採用ジョブは、記事のタイトルが訳した原題と同じものだけに書く
    const added = { ...article('a_9', 'en'), url: 'https://news.example.com/new', title: 'Moss Garden out now' };
    const all = [...articles, added];
    const done = applyTitleTranslations(all, {
      schemaVersion: 1,
      items: [
        { articleId: 'a_1', title: 'Lantern Tide a_1', titleJa: '『Lantern Tide』の記事' },
        { url: 'https://news.example.com/new', title: 'Moss Garden out now', titleJa: '『Moss Garden』配信開始' },
        { articleId: 'a_2', title: 'Lantern Tide a_2', titleJa: '上書きしない' },
      ],
    });
    expect(done).toEqual(['a_1', 'a_9']);
    expect(all[1]!.titleJa).toBe('訳済み');
  });
});

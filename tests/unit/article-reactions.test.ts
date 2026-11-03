import { describe, expect, it } from 'vitest';
import { createFakeLlm } from '../../scripts/llm/client.ts';
import { copiesComment, summarizeReactions, validateReactions } from '../../scripts/pipeline/article-reactions.ts';
import { parseBookmarkEntry, type BookmarkEntry } from '../../scripts/sources/hatena.ts';

// 架空のはてなブックマークのコメント（10 §10.5.1）
const title = '『Lantern Tide』の続編が発表';
const entry: BookmarkEntry = {
  entryUrl: 'https://b.hatena.ne.jp/entry/s/example.com/news/1',
  count: 42,
  comments: [
    '前作は灯台を巡るのが本当に楽しかったので続編は嬉しい',
    '続編きた！前作の灯台めぐりが良かった',
    'Lantern Tide Remasteredも遊んだけど、今度は協力プレイがほしい',
    '開発規模が小さいのに続編まで出せるのはすごい',
  ],
};
const at = { at: '2026-10-29T00:00:00Z', model: 'fake', runId: 'test' };

describe('はてなブックマークの反応の要約', () => {
  it('エントリーの JSON を読み、空のコメントと「あとで読む」を除く', () => {
    const text = JSON.stringify({
      count: 3,
      entry_url: 'https://b.hatena.ne.jp/entry/s/example.com/',
      bookmarks: [
        { user: 'a', comment: '  とても  面白そうなゲームだ ' },
        { user: 'b', comment: '' },
        { user: 'c', comment: 'あとで読む' },
      ],
    });
    expect(parseBookmarkEntry(text)).toEqual({
      entryUrl: 'https://b.hatena.ne.jp/entry/s/example.com/',
      count: 3,
      comments: ['とても 面白そうなゲームだ'],
    });
    // ブックマークのない URL では "null" が返る
    expect(parseBookmarkEntry('null')).toBeUndefined();
  });

  it('コメントの写しは捨てるが、タイトルの語や作品名の一致は写しとみなさない', () => {
    expect(copiesComment('灯台を巡るのが本当に楽しかったという声', entry.comments, title)).toBe(true);
    expect(copiesComment('Lantern Tide Remasteredを遊んだ人の声', entry.comments, title)).toBe(false);
    expect(copiesComment('『Lantern Tide』の続編が発表されて喜ぶ声', entry.comments, title)).toBe(false);
  });

  it('根拠のない行、罵倒、長すぎる行を捨て、支えの多い順に並べる', () => {
    const v = validateReactions(
      {
        points: [
          { text: '小さな開発元が続編を出せたことに感心する声', commentIds: ['c4'] },
          { text: '前作の探索の楽しさを思い出して続編を喜ぶ声', commentIds: ['c1', 'c2', 'c2'] },
          { text: '存在しない根拠のある反応という行', commentIds: ['c9'] },
          { text: 'こんなのクソだという声がとても多いという話', commentIds: ['c1'] },
          { text: 'あ'.repeat(51), commentIds: ['c1'] },
        ],
      },
      entry.comments,
      title,
    );
    expect(v.points).toEqual([
      { text: '前作の探索の楽しさを思い出して続編を喜ぶ声', support: 2 },
      { text: '小さな開発元が続編を出せたことに感心する声', support: 1 },
    ]);
    expect(v.errors.join('\n')).toMatch(/根拠がない[\s\S]*罵倒や主観の表現[\s\S]*長さ/);
  });

  it('捨てた行があれば理由を添えて1回だけ書き直させる', async () => {
    const llm = createFakeLlm([
      { points: [{ text: '灯台を巡るのが本当に楽しかったという声', commentIds: ['c1'] }] },
      {
        points: [
          { text: '前作の探索の楽しさを思い出して続編を喜ぶ声', commentIds: ['c1', 'c2'] },
          { text: '協力プレイへの対応を望む声', commentIds: ['c3'] },
        ],
      },
    ]);
    const r = await summarizeReactions(llm, { id: 'a_0000000000000001', title }, entry, at);
    expect(r.entry.points.map((p) => p.text)).toEqual(['前作の探索の楽しさを思い出して続編を喜ぶ声', '協力プレイへの対応を望む声']);
    expect(r.entry).toMatchObject({ bookmarkCount: 42, commentCount: 4, model: 'fake' });
    expect(llm.prompts[1]).toContain('コメントの文の写し');
  });

  it('コメントが少なければ LLM を呼ばず、件数だけを残す', async () => {
    const llm = createFakeLlm([]);
    const r = await summarizeReactions(llm, { id: 'a_0000000000000001', title }, { ...entry, comments: ['ひとつだけのコメント'] }, at);
    expect(r.entry.points).toEqual([]);
    expect(r.entry.model).toBeUndefined();
    expect(llm.prompts).toHaveLength(0);
  });
});

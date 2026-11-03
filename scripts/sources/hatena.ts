import { z } from 'zod';

/**
 * はてなブックマークのエントリー情報 API（https://developer.hatena.ne.jp/ja/documents/bookmark/apis/getinfo）。
 * 関連エントリーを使わないので、速い jsonlite を使う。ブックマークのない URL では "null" が返る
 */
export function bookmarkEntryUrl(url: string): string {
  return `https://b.hatena.ne.jp/entry/jsonlite/?url=${encodeURIComponent(url)}`;
}

const Entry = z.object({
  count: z.number().int().min(0),
  entry_url: z.string().url(),
  bookmarks: z.array(z.object({ comment: z.string().optional() }).passthrough()).default([]),
});

export interface BookmarkEntry {
  entryUrl: string;
  count: number;
  comments: string[]; // 空でないコメント（投稿者は持たない）
}

// これより短いコメントは要約の材料にしない（「あとで読む」のような印が多い）
const MIN_COMMENT_CHARS = 6;

export function parseBookmarkEntry(text: string): BookmarkEntry | undefined {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  const r = Entry.safeParse(json);
  if (!r.success) return undefined;
  const comments = r.data.bookmarks
    .map((b) => (b.comment ?? '').replace(/\s+/g, ' ').trim())
    .filter((c) => [...c].length >= MIN_COMMENT_CHARS && !/^(あとで読む|後で読む|メモ|あとで)$/.test(c));
  return { entryUrl: r.data.entry_url, count: r.data.count, comments };
}

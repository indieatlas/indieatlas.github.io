import { z } from 'zod';
import type { ArticleReactions } from '../../schema/media.ts';
import type { LlmClient } from '../llm/client.ts';
import type { BookmarkEntry } from '../sources/hatena.ts';

/**
 * はてなブックマークのコメントから、記事への主な反応をいくつか選んで要約する（06 §6.13.7）。
 * はてなの API の規約により、コメントの文はそのまま載せない。LLM には根拠のコメントの番号を添えさせ、コードで次を確かめる。
 * - 根拠がすべて渡したコメントの番号であること
 * - コメントの文をそのまま写していないこと（記事のタイトルにある語と、作品名のようなカタカナや英字の並びを除いて、10文字以上の一致がない）
 * - 罵倒や主観、URL を含まないこと
 */
export const MIN_COMMENTS = 3;

const Output = z.object({
  points: z.array(z.object({ text: z.string(), commentIds: z.array(z.string()) })).max(6),
});

export const REACTIONS_SYSTEM = [
  'あなたはゲームのニュースサイトの編集者です。',
  'ある記事に付いた、はてなブックマークの利用者のコメントを読み、読者がどう受け止めたかが分かる反応を選んで日本語で要約します。',
  '規則:',
  '- 1〜4行。1行は20〜40文字ほど（50文字以内）で、「〜という声」「〜との指摘」「〜を懐かしむ声」のように、利用者の反応だと分かる形で終える。',
  '- 多くのコメントで共通する反応を先に書く。1件だけでも、ほかにない視点の反応なら選んでよい。似た反応は1行にまとめる。',
  '- 各行には、その反応に触れたコメントの id を commentIds に入れる。',
  '- コメントの文をそのまま写さず、自分の言葉で言い換える。作品名などの固有名詞以外で、コメントと同じ文字列を10文字以上続けて使わない。',
  '- 罵倒、個人や団体への攻撃、差別的な内容、下品な冗談、記事と関係のない話題のコメントは選ばない。',
  '- コメントにないことは書かない。編集者自身の意見や評価、誇張は書かない。',
  '- 出力は JSON だけ: {"points":[{"text":"...","commentIds":["c1","c4"]}]}',
].join('\n');

const BANNED =
  /(https?:|www\.|私は|筆者|僕は|俺は|クソ|カス|ゴミ|死ね|バカ|馬鹿|アホ|キモ|ガイジ|神ゲー|必見|間違いなく)/;

export function reactionsPrompt(title: string, comments: string[]): string {
  const lines = comments.map((c, i) => JSON.stringify({ id: `c${i + 1}`, text: c }));
  return `記事: ${title}\nコメント（${comments.length}件、1行に1件の JSON）:\n${lines.join('\n')}`;
}

const COPY_CHARS = 10;
// 作品名や人名のような、言い換えようのない並び
const NAME_LIKE = /^[A-Za-z0-9ァ-ヶー・･ .:'&!?-]+$/;

/** 記事のタイトルにない10文字以上の部分が、コメントにそのまま含まれていれば写しとみなす */
export function copiesComment(text: string, comments: string[], title: string): boolean {
  for (let i = 0; i + COPY_CHARS <= text.length; i++) {
    const piece = text.slice(i, i + COPY_CHARS);
    if (title.includes(piece) || NAME_LIKE.test(piece)) continue;
    if (comments.some((c) => c.includes(piece))) return true;
  }
  return false;
}

export function validateReactions(
  raw: z.infer<typeof Output>,
  comments: string[],
  title: string,
): { points: { text: string; support: number }[]; errors: string[] } {
  const errors: string[] = [];
  const points: { text: string; support: number }[] = [];
  for (const p of raw.points) {
    const text = p.text.trim();
    const ids = [...new Set(p.commentIds)].filter((id) => {
      const n = Number(id.replace(/^c/, ''));
      return /^c\d+$/.test(id) && n >= 1 && n <= comments.length;
    });
    const problems = [
      [...text].length < 8 || [...text].length > 50 ? '長さ' : '',
      ids.length === 0 ? '根拠がない' : '',
      BANNED.test(text) ? '罵倒や主観の表現' : '',
      copiesComment(text, comments, title) ? 'コメントの文の写し' : '',
      points.some((x) => x.text === text) ? '重複' : '',
    ].filter(Boolean);
    if (problems.length) {
      errors.push(`「${text}」: ${problems.join('、')}`);
      continue;
    }
    points.push({ text, support: ids.length });
  }
  // 多くのコメントに支えられた反応を先にする（同じ数なら LLM の順）
  const sorted = points.map((p, i) => ({ p, i })).sort((a, b) => b.p.support - a.p.support || a.i - b.i);
  return { points: sorted.slice(0, 4).map((x) => x.p), errors };
}

export async function summarizeReactions(
  llm: LlmClient,
  article: { id: string; title: string },
  entry: BookmarkEntry,
  o: { at: string; model: string; runId: string },
): Promise<{ entry: ArticleReactions['entries'][string]; errors: string[] }> {
  const base = {
    entryUrl: entry.entryUrl,
    bookmarkCount: entry.count,
    commentCount: entry.comments.length,
    retrievedAt: o.at,
  };
  if (entry.comments.length < MIN_COMMENTS) {
    return { entry: { ...base, points: [] }, errors: [`コメントが${MIN_COMMENTS}件に満たない`] };
  }
  const comments = entry.comments.slice(0, 80);
  const prompt = reactionsPrompt(article.title, comments);
  const ask = (p: string, attempt: number) =>
    llm.generateObject({
      role: 'triage', // 要約は思考なしで足りる。速く、安い
      sessionId: `ia-${o.runId}-reactions-${article.id}-${attempt}`,
      system: REACTIONS_SYSTEM,
      prompt: p,
      schema: Output,
    });
  let v = validateReactions(await ask(prompt, 1), comments, article.title);
  // 捨てた行があれば、理由を添えて1回だけ書き直させ、多く残ったほうを使う
  if (v.errors.length && v.points.length < 4) {
    const retry = validateReactions(
      await ask(`${prompt}\n\n前回の出力の次の行は使えなかった。理由を直して書き直すこと:\n${v.errors.join('\n')}`, 2),
      comments,
      article.title,
    );
    if (retry.points.length > v.points.length) v = { points: retry.points, errors: [...v.errors, ...retry.errors] };
  }
  return {
    entry: { ...base, points: v.points, ...(v.points.length ? { model: o.model } : {}) },
    errors: v.errors,
  };
}

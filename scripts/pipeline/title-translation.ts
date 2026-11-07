import { z } from 'zod';
import type { LlmClient } from '../llm/client.ts';

/**
 * 日本語以外の記事の見出しを、日本語に訳す（06 §6.13.9）。訳は記事の見出しとして原題とともに表示する。
 * 媒体の見出しを訳したもの（評価や一人称は媒体のもの）なので、当サイトの文章の規則（05 §5.6.3）は当てはめず、
 * URL、絵文字、Markdown、原文にない英字の名前の追加だけを確かめる
 */

export const TITLE_BATCH = 20;

export const TITLE_SYSTEM = [
  'あなたはゲームのニュースサイトの編集者です。英語などのゲームニュースの見出しを、日本語の見出しに訳します。',
  '規則:',
  '- 原文の意味をそのまま、自然な日本語のニュースの見出しにする。原文にない情報、評価、誇張を足さない。',
  '- ゲームの作品名、スタジオ名、人名、機種名は原文の表記（英字）のまま残す。作品名は『』で囲む。',
  '- 文体は見出しの体言止めか常体。「です・ます」にしない。',
  '- 80文字以内を目安にする。',
  '- 出力は JSON だけ: {"items":[{"id":"t1","titleJa":"..."}]}',
].join('\n');

const Output = z.object({ items: z.array(z.object({ id: z.string(), titleJa: z.string() })).max(TITLE_BATCH) });

const JAPANESE = /[぀-ヿ一-鿿]/;
const BANNED = /(https?:|www\.|\*\*|`|^#)/;
const EMOJI = /\p{Extended_Pictographic}/u;
// 訳に、原文にない英字の語（作品名の取り違えなど）が入っていないかを確かめる
const LATIN_WORD = /[A-Za-z][A-Za-z0-9'’.:&-]*/g;

/** 訳した見出しの問題。なければ空 */
export function titleIssues(titleJa: string, original: string): string[] {
  const t = titleJa.trim();
  const problems: string[] = [];
  const len = [...t].length;
  if (len < 4 || len > 150) problems.push('長さ');
  if (!JAPANESE.test(t)) problems.push('日本語でない');
  if (BANNED.test(t) || EMOJI.test(t)) problems.push('使わない表現');
  if (t === original.trim()) problems.push('訳されていない');
  const words = new Set((original.match(LATIN_WORD) ?? []).map((w) => w.toLowerCase().replace(/[’']s$/, '')));
  const added = (t.match(LATIN_WORD) ?? []).filter((w) => {
    const k = w.toLowerCase().replace(/[’']s$/, '');
    return k.length >= 3 && !words.has(k) && ![...words].some((x) => x.includes(k) || k.includes(x));
  });
  if (added.length) problems.push(`原文にない英字（${added.join(', ')}）`);
  return problems;
}

export async function translateTitles(
  llm: LlmClient,
  items: { id: string; title: string }[],
  o: { runId: string; batch: number },
): Promise<{ translated: Map<string, string>; errors: string[] }> {
  const translated = new Map<string, string>();
  const errors: string[] = [];
  const keys = items.map((_, i) => `t${i + 1}`);
  const prompt = `見出し（${items.length}件、1行に1件の JSON）:\n${items
    .map((x, i) => JSON.stringify({ id: keys[i], title: x.title }))
    .join('\n')}`;
  const raw = await llm.generateObject({
    role: 'triage', // 訳は思考なしで足りる。速く、安い
    sessionId: `ia-${o.runId}-titles-${o.batch}`,
    system: TITLE_SYSTEM,
    prompt,
    schema: Output,
  });
  for (const r of raw.items) {
    const i = keys.indexOf(r.id);
    if (i < 0) continue;
    const item = items[i]!;
    const text = r.titleJa.trim();
    const problems = titleIssues(text, item.title);
    if (problems.length) errors.push(`${item.id}「${text}」: ${problems.join('、')}`);
    else translated.set(item.id, text);
  }
  return { translated, errors };
}

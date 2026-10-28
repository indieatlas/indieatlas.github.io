import { z } from 'zod';
import type { ReviewSummaries } from '../../schema/media.ts';
import type { LlmClient } from '../llm/client.ts';
import type { SteamReview } from '../sources/steam.ts';

/**
 * Steam のレビューから、よく挙がる長所と短所をまとめる（06 §6.13.6）。
 * LLM には根拠のレビューの ID を必ず添えさせ、コードで次を確かめる。
 * - 各行の根拠が2件以上あり、すべて渡したレビューの ID であること
 * - 長所の根拠は好評のレビュー、短所の根拠は不評か、好評でも欠点に触れたレビューであること（好評かどうかは問わない）
 * - レビューの文をそのまま写していないこと（8文字以上の一致がない）
 * - 誇張や主観の表現がないこと
 */
export const MIN_REVIEWS = 10;

const Output = z.object({
  pros: z.array(z.object({ text: z.string(), reviewIds: z.array(z.string()) })).max(6),
  cons: z.array(z.object({ text: z.string(), reviewIds: z.array(z.string()) })).max(6),
});

export const SUMMARY_SYSTEM = [
  'あなたはゲームの紹介サイトの編集者です。',
  '渡された Steam の利用者レビューを読み、多くのレビューで共通して挙がっている長所と短所を日本語でまとめます。',
  '規則:',
  '- 長所は1〜4行、短所は0〜3行。1行は8〜60文字の、体言止めか「〜できる」「〜が多い」のような平易な文。',
  '- 各行には、その点に触れているレビューの id を2件以上 reviewIds に入れる。1件しか触れていない点は書かない。',
  '- レビューの文をそのまま写さず、自分の言葉で言い換える。',
  '- 「神ゲー」「最高」「必見」のような誇張、「私は」のような主観、推測は書かない。',
  '- 早期アクセスかどうか、アップデートでの変化、価格やセールなど、時期によって変わる事柄は書かない（古いレビューも含まれるため）。',
  '- 出力は JSON だけ: {"pros":[{"text":"...","reviewIds":["..."]}],"cons":[...]}',
].join('\n');

const BANNED = /(神ゲー|傑作|名作|最高|必見|間違いなく|今すぐ|私は|筆者|僕は|だろう|と思われる|に違いない|https?:)/;
// 時期によって変わる事柄（古いレビューでは事実と違っていることがある）
const DATED = /(早期アクセス|アップデート|アプデ|セール|値下げ|定価|円で)/;

export function summaryPrompt(title: string, reviews: SteamReview[]): string {
  const lines = reviews.map((r) => JSON.stringify({ id: r.id, positive: r.votedUp, text: r.text }));
  return `作品: ${title}\nレビュー（${reviews.length}件、1行に1件の JSON）:\n${lines.join('\n')}`;
}

const copies = (text: string, reviews: SteamReview[]) => {
  for (let i = 0; i + 8 <= text.length; i++) {
    const piece = text.slice(i, i + 8);
    if (reviews.some((r) => r.text.includes(piece))) return true;
  }
  return false;
};

export function validateSummary(
  raw: z.infer<typeof Output>,
  reviews: SteamReview[],
):
  | {
      ok: true;
      pros: { text: string; reviewIds: string[] }[];
      cons: { text: string; reviewIds: string[] }[];
      errors: string[];
    }
  | { ok: false; errors: string[] } {
  const ids = new Set(reviews.map((r) => r.id));
  const byId = new Map(reviews.map((r) => [r.id, r]));
  const errors: string[] = [];
  const check = (kind: 'pros' | 'cons') =>
    raw[kind].filter((p) => {
      const text = p.text.trim();
      const unique = [...new Set(p.reviewIds)].filter((id) => ids.has(id));
      const problems = [
        [...text].length < 8 || [...text].length > 60 ? '長さ' : '',
        unique.length < 2 ? '根拠が2件未満' : '',
        kind === 'pros' && unique.filter((id) => byId.get(id)!.votedUp).length < 2 ? '好評の根拠が2件未満' : '',
        BANNED.test(text) ? '誇張や主観の表現' : '',
        DATED.test(text) ? '時期によって変わる事柄' : '',
        copies(text, reviews) ? 'レビューの文の写し' : '',
      ].filter(Boolean);
      if (problems.length) errors.push(`${kind}「${text}」: ${problems.join('、')}`);
      p.reviewIds = unique;
      p.text = text;
      return problems.length === 0;
    });
  const pros = check('pros').slice(0, 4);
  const cons = check('cons').slice(0, 3);
  if (pros.length === 0) return { ok: false, errors: [...errors, '使える長所がない'] };
  return { ok: true, pros, cons, errors };
}

export async function summarizeReviews(
  llm: LlmClient,
  game: { id: string; title: string },
  reviews: SteamReview[],
  o: { at: string; model: string; runId: string },
): Promise<{ entry?: ReviewSummaries['entries'][string]; errors: string[] }> {
  if (reviews.length < MIN_REVIEWS) return { errors: [`レビューが${MIN_REVIEWS}件に満たない`] };
  const raw = await llm.generateObject({
    role: 'triage', // 要約は思考なしで足りる。速く、安い
    sessionId: `ia-${o.runId}-reviews-${game.id}`,
    system: SUMMARY_SYSTEM,
    prompt: summaryPrompt(game.title, reviews),
    schema: Output,
  });
  const v = validateSummary(raw, reviews);
  if (!v.ok) return { errors: v.errors };
  return {
    entry: { pros: v.pros, cons: v.cons, reviewCount: reviews.length, model: o.model, generatedAt: o.at },
    errors: v.errors, // 除いた行の理由（記録用）
  };
}

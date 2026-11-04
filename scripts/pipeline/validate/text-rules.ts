/**
 * LLM が書く文章の規則（05 §5.6、06 §6.7 の V-C01）。違反した提案は却下する。一覧は運用しながら追加する
 */

const FORBIDDEN: { category: string; patterns: RegExp[] }[] = [
  {
    category: '体験の一人称',
    patterns: [/プレイしてみると/, /実際に遊んで/, /遊んでみた/, /個人的に/, /私は/, /筆者/, /僕は/, /俺は/],
  },
  {
    category: '根拠のない評価',
    patterns: [/神ゲー/, /傑作/, /名作/, /最高の/, /必見/, /必ずハマる/, /間違いなく/, /最高傑作/, /至高/],
  },
  { category: '宣伝の口調', patterns: [/今すぐ/, /お見逃しなく/, /要チェック/, /ぜひ遊んで/, /必携/] },
  { category: '推測', patterns: [/だろう/, /と思われる/, /に違いない/, /かもしれない/] },
];

const URL_RE = /https?:\/\/|www\./i;
const EMOJI_RE = /\p{Extended_Pictographic}/u;
const MARKDOWN_RE = /(^|\s)(#{1,6}\s|[*_]{2}\S|`|\[[^\]]+\]\()/;

export interface TextIssue {
  category: string;
  match: string;
}

/** 文章の違反を返す。allowMarkdown はコレクションの説明だけ */
export function textIssues(text: string, opts: { allowMarkdown?: boolean } = {}): TextIssue[] {
  const out: TextIssue[] = [];
  for (const { category, patterns } of FORBIDDEN) {
    for (const p of patterns) {
      const m = p.exec(text);
      if (m) out.push({ category, match: m[0] });
    }
  }
  if (URL_RE.test(text)) out.push({ category: 'URL', match: URL_RE.exec(text)![0] });
  if (EMOJI_RE.test(text)) out.push({ category: '絵文字', match: EMOJI_RE.exec(text)![0] });
  if (!opts.allowMarkdown && MARKDOWN_RE.test(text))
    out.push({ category: 'Markdown', match: MARKDOWN_RE.exec(text)![0].trim() });
  return out;
}

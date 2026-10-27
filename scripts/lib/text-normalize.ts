const SYMBOLS = /[:：\-–—_・·.,!?！？'"「」『』()（）[\]【】~〜/]/g;
const ROMAN: Record<string, string> = { ii: '2', iii: '3', iv: '4', v: '5', vi: '6' };

/** ひらがなをカタカナにする */
export function toKatakana(s: string): string {
  return s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

/** カタカナをひらがなにする */
export function toHiragana(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** タイトルの正規化（04 §4.3.2）。照合のキーを返す */
export function normalizeTitle(title: string): string {
  // 3. の ™ は NFKC で "TM" に分解されるため、1. の前に外す
  let s = title.replace(/[™®©]/g, '');
  s = s.normalize('NFKC'); // 1. 全角英数字を半角に揃える
  s = s.toLowerCase(); // 2.
  s = s.replace(SYMBOLS, ' '); // 4.
  s = toKatakana(s); // 5.
  // 6. 単独の語としてのローマ数字を算用数字に、& を and に
  s = s.replace(/&/g, ' and ');
  s = s
    .split(/\s+/)
    .map((w) => ROMAN[w] ?? w)
    .join(' ')
    .trim();
  s = s.replace(/^the /, ''); // 7.
  return s.replace(/\s+/g, ''); // 8.
}

/** 検索の索引に加える、仮名を相互に変換した表記（03 §3.6） */
export function kanaVariants(s: string): string[] {
  const variants = new Set([toHiragana(s), toKatakana(s)]);
  variants.delete(s);
  return [...variants];
}

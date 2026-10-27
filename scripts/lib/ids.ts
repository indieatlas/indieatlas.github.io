import { canonicalJson } from './canonical-json.ts';
import { shortHash } from './hash.ts';
import { normalizeUrl } from './url-normalize.ts';

/** 記事: sha256(normalizeUrl(canonicalUrl)) の先頭16桁 */
export function articleId(canonicalUrl: string): string {
  return `a_${shortHash(normalizeUrl(canonicalUrl))}`;
}

/** 催し: sha256(normalizeUrl(url)|開始日) の先頭16桁 */
export function eventId(url: string, startKey: string): string {
  return `ev_${shortHash(`${normalizeUrl(url)}|${startKey}`)}`;
}

/** 正規化した URL のハッシュ（state/seen-urls.json のキー） */
export function urlKey(url: string): string {
  return shortHash(normalizeUrl(url));
}

/** Claim: sha256(gameId|field|canonicalJson(scope)|canonicalJson(value)) の先頭16桁 */
export function claimId(gameId: string, field: string, scope: object, value: unknown): string {
  return `c_${shortHash(`${gameId}|${field}|${canonicalJson(scope)}|${canonicalJson(value)}`)}`;
}

/** 作品間の関係: sha256(a|b|kind)（a < b） */
export function relationId(a: string, b: string, kind: string): string {
  const [x, y] = a < b ? [a, b] : [b, a];
  return `r_${shortHash(`${x}|${y}|${kind}`)}`;
}

/** タスク: sha256(type|targetKey) */
export function taskId(type: string, targetKey: string): string {
  return `t_${shortHash(`${type}|${targetKey}`)}`;
}

/** レビュー待ち: sha256(kind|canonicalJson(payload)) */
export function reviewId(kind: string, payload: unknown): string {
  return `rv_${shortHash(`${kind}|${canonicalJson(payload)}`)}`;
}

const NUMERIC_ID = {
  game: { prefix: 'g_', digits: 6 },
  developer: { prefix: 'dev_', digits: 6 },
  collection: { prefix: 'col_', digits: 4 },
} as const;

/** 既存の ID（統合済みを含む）の最大値に1を足した ID。再利用はしない */
export function nextNumericId(kind: keyof typeof NUMERIC_ID, existing: Iterable<string>): string {
  const { prefix, digits } = NUMERIC_ID[kind];
  let max = 0;
  for (const id of existing) {
    if (!id.startsWith(prefix)) continue;
    const n = Number(id.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  const next = max + 1;
  if (String(next).length > digits) throw new Error(`${kind} id overflow`);
  return prefix + String(next).padStart(digits, '0');
}

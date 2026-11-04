import { scopeKey, type Claim } from '../../schema/claim.ts';
import type { EvidenceKind } from '../../schema/common.ts';
import type { Tag } from '../../schema/taxonomy.ts';
import { canonicalJson } from '../lib/canonical-json.ts';
import { registrableDomain, storeOf } from '../lib/domains.ts';

/**
 * Claim の採用アルゴリズム（06 §6.8）。作品ごとに、すべての Claim の状態を計算し直す。
 * 決定的で、同じ入力なら同じ結果になる。文章の項目（summary、features、overview）は、
 * 置き換えの条件（V-C04）を確かめた apply.ts が状態を決めるので、ここでは扱わない。
 */

const TIER: Record<EvidenceKind, number> = { official: 3, store: 3, media: 2, event: 2, database: 1 };
const LIVE = new Set(['adopted', 'candidate', 'conflicted']);
const VALUE_ONE = new Set(['release', 'japaneseSupport', 'playerModes']);
export const MAX_ADOPTED_TAGS = 12;

export function tier(c: Pick<Claim, 'evidence'>): number {
  return Math.max(0, ...c.evidence.map((e) => TIER[e.kind]));
}

export function independentCount(c: Pick<Claim, 'evidence'>): number {
  return new Set(c.evidence.map((e) => e.originKey)).size;
}

/** rank の比較。上位ほど小さい（並べると先頭が最上位） */
export function compareRank(a: Claim, b: Claim): number {
  return (
    tier(b) - tier(a) ||
    (a.asOf < b.asOf ? 1 : a.asOf > b.asOf ? -1 : 0) ||
    independentCount(b) - independentCount(a) ||
    (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0) ||
    (a.id < b.id ? -1 : 1)
  );
}

/** 値の比較。発売情報は状態と日付だけで比べる（原文の表記 rawText の違いは同じ値として扱う） */
export function valueKey(c: Pick<Claim, 'field' | 'value'>): string {
  if (c.field === 'release') {
    const v = c.value as { status: string; date?: unknown };
    return canonicalJson({ status: v.status, date: v.date });
  }
  return canonicalJson(c.value);
}
const sameValue = (a: Claim, b: Claim) => valueKey(a) === valueKey(b);

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

export interface ResolveResult {
  /** 矛盾が生じたグループ。fix-conflict タスクを作る */
  conflicts: { field: Claim['field']; scope: Claim['scope']; claimIds: string[] }[];
  changed: number; // 状態が変わった Claim の数
}

function setStatus(c: Claim, status: Claim['status'], reason: Claim['statusReason'], at: string, res: ResolveResult) {
  if (c.status === status && c.statusReason === reason) return;
  const wasAdopted = c.status === 'adopted';
  c.status = status;
  if (reason) c.statusReason = reason;
  else delete c.statusReason;
  if (status === 'adopted' && !wasAdopted) c.adoptedAt = at;
  if (status !== 'superseded') delete c.supersededBy;
  c.updatedAt = at;
  res.changed++;
}

function resolveSingle(group: Claim[], all: Map<string, Claim>, at: string, res: ResolveResult): void {
  let live = group.filter((c) => LIVE.has(c.status));
  // 1. 明示的な置き換え（延期の告知など）
  for (const c of [...live].sort((a, b) => (a.asOf < b.asOf ? -1 : a.asOf > b.asOf ? 1 : 0))) {
    if (!LIVE.has(c.status)) continue;
    for (const sid of c.supersedes ?? []) {
      const s = all.get(sid);
      if (!s || !LIVE.has(s.status)) continue;
      if (tier(c) >= tier(s) && c.asOf >= s.asOf) {
        setStatus(s, 'superseded', 'newer-source', at, res);
        s.supersededBy = c.id;
        if (c.status === 'adopted') continue;
        // 置き換えた Claim は、以前の採用を引き継ぐ
        if (s.adoptedAt) setStatus(c, 'adopted', 'newer-source', at, res);
      }
    }
  }
  live = group.filter((c) => LIVE.has(c.status));
  if (live.length === 0) return;
  let current = live.find((c) => c.status === 'adopted');
  const ranked = [...live].sort(compareRank);
  const top = ranked[0]!;

  // 2. 同順位の矛盾
  // 公式とストア（順位3）のより新しい情報は、前の情報の更新として扱い、矛盾にしない
  const rivals = live.filter(
    (c) =>
      c !== top &&
      !sameValue(c, top) &&
      tier(c) === tier(top) &&
      daysBetween(c.asOf, top.asOf) <= 14 &&
      !(tier(top) === 3 && c.asOf < top.asOf),
  );
  if (rivals.length > 0) {
    if (current) {
      for (const c of live) if (c !== current) setStatus(c, 'conflicted', 'conflict-same-rank', at, res);
    } else {
      for (const c of [top, ...rivals]) setStatus(c, 'conflicted', 'conflict-same-rank', at, res);
    }
    res.conflicts.push({ field: top.field, scope: top.scope, claimIds: [top.id, ...rivals.map((r) => r.id)] });
    return;
  }

  // 3. 採用と置き換え
  if (!current) {
    setStatus(top, 'adopted', 'highest-rank', at, res);
    current = top;
  } else if (top !== current) {
    const canReplace =
      tier(top) > tier(current) ||
      (tier(top) === tier(current) && top.asOf > current.asOf && (tier(top) === 3 || independentCount(top) >= 2));
    if (canReplace) {
      setStatus(top, 'adopted', tier(top) > tier(current) ? 'higher-tier-source' : 'newer-source', at, res);
      setStatus(current, 'superseded', 'newer-source', at, res);
      current.supersededBy = top.id;
      current = top;
    }
  }

  // 4. 採用済みより新しいが、置き換えの条件を満たさない情報
  const conflicted: string[] = [];
  for (const c of live) {
    if (c === current || !LIVE.has(c.status)) continue;
    if (sameValue(c, current)) {
      // 同じ値の別の Claim（範囲の表記違いなど）は候補のまま
      setStatus(c, 'candidate', 'outranked', at, res);
    } else if (c.asOf > current.asOf) {
      setStatus(c, 'conflicted', 'conflict-same-rank', at, res);
      conflicted.push(c.id);
    } else {
      setStatus(c, 'candidate', 'outranked', at, res);
    }
  }
  if (conflicted.length)
    res.conflicts.push({ field: current.field, scope: current.scope, claimIds: [current.id, ...conflicted] });
}

/** storeLink は、根拠が store か official で、URL がそのストアのドメインなら採用する */
function storeLinkOk(c: Extract<Claim, { field: 'storeLink' }>): boolean {
  if (!c.evidence.some((e) => e.kind === 'store' || e.kind === 'official')) return false;
  const store = storeOf(c.value.url);
  if (c.value.store === 'official' || c.value.store === 'other') return registrableDomain(c.value.url).length > 0;
  return store === c.value.store;
}

export function resolveGameClaims(
  claims: Claim[],
  ctx: { at: string; tags: Tag[]; newIds: Set<string> },
): ResolveResult {
  const res: ResolveResult = { conflicts: [], changed: 0 };
  const all = new Map(claims.map((c) => [c.id, c]));
  const groups = new Map<string, Claim[]>();
  for (const c of claims) {
    if (!VALUE_ONE.has(c.field)) continue;
    const key = `${c.field}|${scopeKey(c.scope)}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  for (const key of [...groups.keys()].sort()) resolveSingle(groups.get(key)!, all, ctx.at, res);

  // 値が複数の項目（06 §6.8.4）
  const tagById = new Map(ctx.tags.map((t) => [t.id, t]));
  const tags = claims.filter((c): c is Extract<Claim, { field: 'tag' }> => c.field === 'tag' && LIVE.has(c.status));
  const usable = tags.filter((c) => {
    const t = tagById.get(c.value.tagId);
    return t && t.status !== 'deprecated';
  });
  const keep = [...usable]
    .sort(
      (a, b) =>
        Number(b.status === 'adopted') - Number(a.status === 'adopted') ||
        independentCount(b) - independentCount(a) ||
        (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0),
    )
    .slice(0, MAX_ADOPTED_TAGS);
  for (const c of tags) {
    if (keep.includes(c)) {
      if (c.status !== 'adopted') setStatus(c, 'adopted', 'highest-rank', ctx.at, res);
    } else if (usable.includes(c)) setStatus(c, 'candidate', 'tag-limit', ctx.at, res);
  }
  // この実行で加わった storeLink と image（V-C05 は検証で確かめ済み）
  for (const c of claims) {
    if (c.status !== 'candidate' || !ctx.newIds.has(c.id)) continue;
    if (c.field === 'storeLink' && storeLinkOk(c)) setStatus(c, 'adopted', 'highest-rank', ctx.at, res);
    if (c.field === 'image') setStatus(c, 'adopted', 'highest-rank', ctx.at, res);
  }
  return res;
}

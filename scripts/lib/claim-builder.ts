import type { Claim, ClaimField, ClaimOf, ClaimsFile, Evidence } from '../../schema/claim.ts';
import type { Actor } from '../../schema/common.ts';
import { claimId } from './ids.ts';

type ValueOf<F extends ClaimField> = ClaimOf<F>['value'];

export interface ClaimInput<F extends ClaimField> {
  gameId: string;
  field: F;
  scope?: ClaimOf<F>['scope'];
  value: ValueOf<F>;
  basis?: ClaimOf<F>['basis'];
  evidence: Evidence[];
  asOf: string;
  status?: ClaimOf<F>['status'];
  statusReason?: ClaimOf<F>['statusReason'];
  at: string; // 作成と更新の日時
  createdBy: Actor;
  createdByRun: string;
}

const DEFAULT_BASIS: Record<ClaimField, Claim['basis']> = {
  release: 'fact',
  japaneseSupport: 'fact',
  playerModes: 'fact',
  summary: 'editorial',
  features: 'editorial',
  tag: 'editorial',
  storeLink: 'fact',
  image: 'fact',
};

/** ID を計算して Claim を作る。status が adopted なら adoptedAt を at にする */
export function makeClaim<F extends ClaimField>(input: ClaimInput<F>): ClaimOf<F> {
  const scope = input.scope ?? {};
  const status = input.status ?? 'adopted';
  return {
    id: claimId(input.gameId, input.field, scope, input.value),
    gameId: input.gameId,
    scope,
    basis: input.basis ?? DEFAULT_BASIS[input.field],
    evidence: input.evidence,
    asOf: input.asOf,
    status,
    ...(input.statusReason
      ? { statusReason: input.statusReason }
      : status === 'adopted'
        ? { statusReason: 'highest-rank' }
        : {}),
    ...(status === 'adopted' ? { adoptedAt: input.at } : {}),
    createdAt: input.at,
    updatedAt: input.at,
    lastCheckedAt: input.evidence.reduce(
      (m, e) => (e.retrievedAt > m ? e.retrievedAt : m),
      input.evidence[0]!.retrievedAt,
    ),
    createdBy: input.createdBy,
    createdByRun: input.createdByRun,
    field: input.field,
    value: input.value,
  } as unknown as ClaimOf<F>;
}

/**
 * Claim を ClaimsFile に加える。同じ ID の Claim があれば、根拠だけを追記する（04 §4.2.1）。
 * 戻り値は追加したか（新しい Claim だったか）。
 */
export function upsertClaim(file: ClaimsFile, claim: Claim): boolean {
  const existing = file.claims.find((c) => c.id === claim.id);
  if (!existing) {
    file.claims.push(claim);
    return true;
  }
  for (const e of claim.evidence) {
    if (!existing.evidence.some((x) => x.url === e.url && x.locator === e.locator && x.quote === e.quote)) {
      existing.evidence.push(e);
    }
  }
  if (claim.lastCheckedAt > existing.lastCheckedAt) existing.lastCheckedAt = claim.lastCheckedAt;
  return false;
}

/** 古い Claim を新しい Claim で置き換えた印を付ける（延期など） */
export function supersede(older: Claim, newer: Claim, at: string): void {
  older.status = 'superseded';
  older.statusReason = 'newer-source';
  older.supersededBy = newer.id;
  older.updatedAt = at;
  newer.supersedes = [...new Set([...(newer.supersedes ?? []), older.id])];
  newer.statusReason = 'newer-source';
}

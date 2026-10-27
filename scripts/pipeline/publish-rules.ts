import type { Claim } from '../../schema/claim.ts';
import type { Developer } from '../../schema/developer.ts';
import { NEGATIVE_INDIE_REASONS, type Game } from '../../schema/game.ts';
import type { Task } from '../../schema/state.ts';

export type IndieAssessment = Game['indie']['assessment'];

/**
 * インディーかどうかを reasons から計算する（04 §4.4.3）。
 * 根拠の検証（06 §6.7）は第2段階で加える。
 */
export function assessIndie(game: Pick<Game, 'indie' | 'publisherIds'>, developers: Developer[]): IndieAssessment {
  const devById = new Map(developers.map((d) => [d.id, d]));
  const reasons = game.indie.reasons.filter((r) => {
    // パブリッシャーの独立性に基づく理由は、人が登録した Developer の値と一致する場合だけ数える
    if (r.code === 'independent-publisher' || r.code === 'major-publisher') {
      const want = r.code === 'independent-publisher' ? 'independent' : 'major';
      return game.publisherIds.some((id) => {
        const d = devById.get(id);
        return d?.independence.status === want && d.independence.setBy === 'human';
      });
    }
    return true;
  });
  const negative = reasons.some(
    (r) =>
      NEGATIVE_INDIE_REASONS.includes(r.code) && r.evidence.some((e) => e.kind === 'official' || e.kind === 'store'),
  );
  if (negative) return 'not-indie';
  if (reasons.some((r) => !NEGATIVE_INDIE_REASONS.includes(r.code))) return 'indie';
  return 'unknown';
}

export interface PublishCheck {
  ok: boolean;
  failed: string[]; // 満たさない条件の番号（P-1 など）
}

/**
 * candidate から published に移せるか（05 §5.5.1）。P-7（1回の実行での上限）は呼び出し側で数える。
 * P-6（除外の方針）は、第2段階で Steam の記述子の判定を加える。
 */
export function canPublish(game: Game, claims: Claim[], tasks: Task[], developers: Developer[]): PublishCheck {
  const failed: string[] = [];
  const hasStrongKey = Object.values(game.externalIds).some((v) => v !== undefined);
  const identityOk =
    (game.officialUrl && game.identityEvidence.some((e) => e.field === 'officialUrl')) ||
    (hasStrongKey && game.identityEvidence.some((e) => e.field === 'externalIds'));
  if (!identityOk) failed.push('P-1');
  if (!game.title.display || !game.title.original) failed.push('P-2');
  if (!claims.some((c) => c.field === 'summary' && c.status === 'adopted')) failed.push('P-3');
  if (assessIndie(game, developers) !== 'indie') failed.push('P-4');
  const blocking = tasks.some(
    (t) =>
      (t.type === 'fix-duplicate' || t.type === 'fix-reported-error') &&
      (t.status === 'open' || t.status === 'blocked') &&
      t.target.gameId === game.id,
  );
  if (blocking) failed.push('P-5');
  return { ok: failed.length === 0, failed };
}

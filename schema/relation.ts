import { z } from 'zod';
import { Evidence } from './claim.ts';
import { Actor, ClaimId, GameId, IsoDateTime, RelationId, RelationKind, RunId } from './common.ts';

export const GameRelation = z.object({
  id: RelationId,
  a: GameId, // a < b（辞書順）
  b: GameId,
  kind: RelationKind,
  reason: z.string().min(10).max(100), // 両方の作品のページに出すため、どちらから見ても成り立つ文にする
  basis: z.enum(['fact', 'editorial']),
  evidenceClaimIds: z.array(ClaimId).max(10),
  evidence: z.array(Evidence).max(5),
  status: z.enum(['adopted', 'candidate', 'rejected']),
  createdBy: Actor,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  createdByRun: RunId,
});
export type GameRelation = z.infer<typeof GameRelation>;

export const GameRelationsFile = z.object({
  schemaVersion: z.literal(1),
  relations: z.array(GameRelation), // a、b、kind の順に並べる
});
export type GameRelationsFile = z.infer<typeof GameRelationsFile>;

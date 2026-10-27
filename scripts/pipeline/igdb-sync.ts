import type { Claim, ClaimsFile, Evidence } from '../../schema/claim.ts';
import type { Actor } from '../../schema/common.ts';
import type { Game } from '../../schema/game.ts';
import { makeClaim, upsertClaim } from '../lib/claim-builder.ts';
import { scopeKey } from '../../schema/claim.ts';
import { igdbPageUrl, igdbReleases, igdbScreenshotUrl, type IgdbGame } from '../sources/igdb.ts';

/**
 * IGDB の情報で作品を補う（データベースの根拠。信頼の順位は最も低い。06 §6.8）。
 * - externalIds.igdbId を設定する
 * - Steam 以外の機種の発売情報を加える。同じ機種と地域に採用済みの Claim があれば加えない
 * - スクリーンショットの画像の Claim を加える（最大 MAX_SCREENSHOTS 枚）
 */
export const MAX_SCREENSHOTS = 8;

export interface IgdbSyncOptions {
  at: string; // ISO 8601
  today: string; // YYYY-MM-DD（日本時間）
  createdBy: Actor;
  runId: string;
}

export interface IgdbSyncResult {
  game: Game;
  claims: ClaimsFile;
  added: { releases: string[]; screenshots: number };
}

function evidence(g: IgdbGame, at: string, locator: string): Evidence {
  return { kind: 'database', url: igdbPageUrl(g), retrievedAt: at, locator, originKey: 'database:igdb.com' };
}

export function applyIgdb(game: Game, file: ClaimsFile | undefined, ig: IgdbGame, o: IgdbSyncOptions): IgdbSyncResult {
  const claims: ClaimsFile = structuredClone(file) ?? { schemaVersion: 1, gameId: game.id, claims: [] };
  const next: Game = structuredClone(game);
  if (next.externalIds.igdbId !== ig.id) {
    next.externalIds = { ...next.externalIds, igdbId: ig.id };
    next.identityEvidence = [
      ...next.identityEvidence.filter(
        (e) => !(e.field === 'externalIds' && e.evidence.originKey === 'database:igdb.com'),
      ),
      { field: 'externalIds', evidence: evidence(ig, o.at, 'igdb:external_games.steam') },
    ];
    next.updatedAt = o.at;
  }

  const base = { gameId: game.id, at: o.at, createdBy: o.createdBy, createdByRun: o.runId, asOf: o.today };
  const adoptedRelease = (c: Claim) => c.field === 'release' && (c.status === 'adopted' || c.status === 'conflicted');
  const covered = new Set(claims.claims.filter(adoptedRelease).map((c) => c.scope.platform));
  const releases: string[] = [];
  for (const r of igdbReleases(ig, o.today)) {
    if (covered.has(r.platform)) continue; // ストアなど、より信頼できる根拠がある機種は上書きしない
    const claim = makeClaim({
      ...base,
      field: 'release',
      scope: { platform: r.platform, region: r.region },
      value: { status: r.status, ...(r.date ? { date: r.date } : {}), ...(r.rawText ? { rawText: r.rawText } : {}) },
      basis: 'reported',
      evidence: [evidence(ig, o.at, 'igdb:games.release_dates')],
    });
    if (
      claims.claims.some(
        (c) => c.field === 'release' && c.status === 'adopted' && scopeKey(c.scope) === scopeKey(claim.scope),
      )
    )
      continue;
    if (upsertClaim(claims, claim)) releases.push(`${r.platform}:${r.status}`);
  }

  let screenshots = 0;
  const existing = claims.claims.filter((c) => c.field === 'image' && c.value.role === 'screenshot').length;
  for (const s of (ig.screenshots ?? []).slice(0, Math.max(0, MAX_SCREENSHOTS - existing))) {
    const claim = makeClaim({
      ...base,
      field: 'image',
      value: {
        url: igdbScreenshotUrl(s.image_id),
        role: 'screenshot',
        width: 889,
        height: 500,
        alt: `${game.title.display} のスクリーンショット`,
        usage: {
          basis: 'other-permitted',
          credit: 'IGDB',
          note: 'IGDB の API が配信する画像。出典として IGDB を表示する',
        },
      },
      evidence: [evidence(ig, o.at, 'igdb:games.screenshots')],
    });
    if (upsertClaim(claims, claim)) screenshots++;
  }
  if (releases.length || screenshots) next.updatedAt = o.at;
  return { game: next, claims, added: { releases, screenshots } };
}

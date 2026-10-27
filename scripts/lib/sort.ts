import type { Article } from '../../schema/article.ts';
import type { ClaimsFile } from '../../schema/claim.ts';
import { ClaimField, scopeKey } from '../../schema/claim.ts';
import type { Collection } from '../../schema/collection.ts';
import type { Game } from '../../schema/game.ts';
import type { GameRelationsFile } from '../../schema/relation.ts';
import type { ReviewQueue, RunsFile, SeenUrls, TasksFile } from '../../schema/state.ts';
import type { TagsFile } from '../../schema/taxonomy.ts';

/** 文字列を code unit の順で比べる（ロケールに依存させない） */
export function cmp(a: string | number, b: string | number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** キーの組で比べる関数を作る */
export function by<T>(...keys: ((x: T) => string | number)[]): (a: T, b: T) => number {
  return (a, b) => {
    for (const k of keys) {
      const c = cmp(k(a), k(b));
      if (c !== 0) return c;
    }
    return 0;
  };
}

const FIELD_ORDER = new Map(ClaimField.options.map((f, i) => [f, i]));
const ROLE_ORDER: Record<string, number> = { primary: 0, roundup: 1, mention: 2 };

// 04 で定める並び順。writeJson の前に通し、同じデータからは常に同じバイト列を作る

export function sortGame(g: Game): Game {
  return {
    ...g,
    aliases: [...g.aliases].sort(
      by(
        (a) => a.kind,
        (a) => a.value,
      ),
    ),
    associatedApps: [...g.associatedApps].sort(
      by(
        (a) => a.store,
        (a) => a.id,
      ),
    ),
    identityEvidence: [...g.identityEvidence].sort(
      by(
        (e) => e.field,
        (e) => e.evidence.retrievedAt,
      ),
    ),
  };
}

export function sortClaimsFile(f: ClaimsFile): ClaimsFile {
  return {
    ...f,
    claims: [...f.claims]
      .map((c) => ({
        ...c,
        evidence: [...c.evidence].sort(
          by(
            (e) => e.retrievedAt,
            (e) => e.url,
          ),
        ),
      }))
      .sort(
        by(
          (c) => FIELD_ORDER.get(c.field) ?? 99,
          (c) => scopeKey(c.scope),
          (c) => c.createdAt,
          (c) => c.id,
        ),
      ) as ClaimsFile['claims'],
  };
}

export function sortArticle(a: Article): Article {
  return {
    ...a,
    games: [...a.games].sort(
      by(
        (g) => ROLE_ORDER[g.role] ?? 9,
        (g) => g.gameId,
      ),
    ),
  };
}

export function sortCollection(c: Collection): Collection {
  return {
    ...c,
    items: [...c.items].sort(
      by(
        (i) => i.position,
        (i) => i.gameId,
      ),
    ),
  };
}

export function sortRelations(f: GameRelationsFile): GameRelationsFile {
  return {
    ...f,
    relations: [...f.relations].sort(
      by(
        (r) => r.a,
        (r) => r.b,
        (r) => r.kind,
      ),
    ),
  };
}

export function sortTags(f: TagsFile): TagsFile {
  return { ...f, tags: [...f.tags].sort(by((t) => t.id)) };
}

export function sortTasks(f: TasksFile): TasksFile {
  return { ...f, tasks: [...f.tasks].sort(by((t) => t.id)) };
}

export function sortReviewQueue(f: ReviewQueue): ReviewQueue {
  return { ...f, items: [...f.items].sort(by((i) => i.id)) };
}

export function sortRuns(f: RunsFile): RunsFile {
  return {
    ...f,
    runs: [...f.runs].sort(
      by(
        (r) => r.startedAt,
        (r) => r.runId,
      ),
    ),
  };
}

export function sortSeenUrls(f: SeenUrls): SeenUrls {
  const entries: SeenUrls['entries'] = {};
  for (const k of Object.keys(f.entries).sort()) entries[k] = f.entries[k]!;
  return { ...f, entries };
}

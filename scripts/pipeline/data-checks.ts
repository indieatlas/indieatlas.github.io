import fs from 'node:fs';
import path from 'node:path';
import { SINGLE_VALUE_FIELDS, scopeKey, type Claim } from '../../schema/claim.ts';
import { MIN_PUBLISHED_COLLECTION_ITEMS } from '../../schema/collection.ts';
import { claimsView, matchesRules } from '../lib/claims-view.ts';
import { articleId, claimId, eventId, relationId } from '../lib/ids.ts';
import { startOf } from '../lib/partial-date.ts';
import {
  FILE_KINDS,
  formatJson,
  listJsonFiles,
  PROJECT_ROOT,
  repoPath,
  repoRoot,
  type RepoData,
} from '../lib/repo-io.ts';
import { associatedAppKeys, strongKeys } from '../lib/strong-keys.ts';
import { SECRET_PATTERN } from '../lib/secrets.ts';
import { normalizeTitle } from '../lib/text-normalize.ts';
import { canPublish } from './publish-rules.ts';

export interface CheckIssue {
  rule: string; // D-01 など
  file?: string; // repoRoot からの相対パス
  message: string;
}

function rel(file: string): string {
  return path.relative(repoRoot(), file);
}

/**
 * D-01、D-02、D-14 をファイル単位で検証し、正しく読めたデータを返す。
 * 読めなかったファイルは、参照の検証（D-03 以降）から除く。
 */
export function checkFiles(): { issues: CheckIssue[]; data: RepoData | undefined } {
  const issues: CheckIssue[] = [];
  const parsed = new Map<string, unknown[]>();
  for (const kind of FILE_KINDS) {
    const files = kind.dir ? listJsonFiles(repoPath(kind.dir)) : [repoPath(kind.file!)];
    const values: unknown[] = [];
    for (const file of files) {
      if (!fs.existsSync(file)) {
        if (kind.name === 'runtime') issues.push({ rule: 'D-01', file: rel(file), message: 'file is missing' });
        continue;
      }
      const text = fs.readFileSync(file, 'utf8');
      if (SECRET_PATTERN.test(text)) {
        issues.push({ rule: 'D-14', file: rel(file), message: 'contains a secret-like string' });
      }
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch (e) {
        issues.push({ rule: 'D-01', file: rel(file), message: `invalid JSON: ${(e as Error).message}` });
        continue;
      }
      const result = kind.schema.safeParse(raw);
      if (!result.success) {
        const detail = result.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        issues.push({ rule: 'D-01', file: rel(file), message: `schema: ${detail}` });
        continue;
      }
      if (kind.idOf && path.basename(file, '.json') !== kind.idOf(result.data)) {
        issues.push({
          rule: 'D-01',
          file: rel(file),
          message: `file name does not match id ${kind.idOf(result.data)}`,
        });
      }
      const expected = formatJson(kind.schema, kind.sort(result.data));
      if (text !== expected) {
        issues.push({
          rule: 'D-02',
          file: rel(file),
          message: 'not in canonical form (format or order); rewrite with writeJson',
        });
      }
      values.push(result.data);
    }
    parsed.set(kind.name, values);
  }
  // config/policy.md なども D-14 の対象にする
  for (const dir of ['config', 'state', 'data']) {
    for (const file of walk(repoPath(dir))) {
      if (file.endsWith('.json')) continue;
      if (SECRET_PATTERN.test(fs.readFileSync(file, 'utf8'))) {
        issues.push({ rule: 'D-14', file: rel(file), message: 'contains a secret-like string' });
      }
    }
  }
  const runtime = parsed.get('runtime')?.[0];
  if (!runtime) return { issues, data: undefined };
  const one = <T>(name: string, fallback: T): T => (parsed.get(name)?.[0] as T | undefined) ?? fallback;
  const claims = new Map<string, RepoData['claims'] extends Map<string, infer V> ? V : never>();
  for (const c of (parsed.get('claims') ?? []) as { gameId: string }[]) claims.set(c.gameId, c as never);
  const data: RepoData = {
    games: (parsed.get('game') ?? []) as RepoData['games'],
    claims,
    articles: (parsed.get('article') ?? []) as RepoData['articles'],
    developers: (parsed.get('developer') ?? []) as RepoData['developers'],
    events: (parsed.get('event') ?? []) as RepoData['events'],
    collections: (parsed.get('collection') ?? []) as RepoData['collections'],
    relations: one('relations', { schemaVersion: 1, relations: [] }),
    tags: one('tags', { schemaVersion: 1, tags: [] }),
    palettes: one('palettes', { schemaVersion: 1, entries: {} }),
    popularity: one('popularity', { schemaVersion: 1, entries: {} }),
    reviewSummaries: one('review-summaries', { schemaVersion: 1, entries: {} }),
    tasks: one('tasks', { schemaVersion: 1, tasks: [] }),
    reviewQueue: one('review-queue', { schemaVersion: 1, items: [] }),
    seenUrls: one('seen-urls', { schemaVersion: 1, entries: {} }),
    sources: one('sources', { schemaVersion: 1, sources: [] }),
    runtime: runtime as RepoData['runtime'],
  };
  return { issues, data };
}

function* walk(dir: string): Generator<string> {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else yield p;
  }
}

/** D-03〜D-13 */
export function checkConsistency(data: RepoData): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const add = (rule: string, file: string, message: string) => issues.push({ rule, file, message });
  const gameById = new Map(data.games.map((g) => [g.id, g]));
  const devIds = new Set(data.developers.map((d) => d.id));
  const tagIds = new Set(data.tags.tags.map((t) => t.id));
  const claimsOf = (id: string): Claim[] => data.claims.get(id)?.claims ?? [];
  const gameFile = (id: string) => `data/games/${id}.json`;
  const claimFile = (id: string) => `data/claims/${id}.json`;

  // D-03: 参照先が存在する
  for (const g of data.games) {
    for (const id of [...g.developerIds, ...g.publisherIds]) {
      if (!devIds.has(id)) add('D-03', gameFile(g.id), `developer ${id} does not exist`);
    }
    if (g.mergedInto && !gameById.has(g.mergedInto))
      add('D-03', gameFile(g.id), `mergedInto ${g.mergedInto} does not exist`);
  }
  for (const [gameId, file] of data.claims) {
    if (!gameById.has(gameId)) add('D-03', claimFile(gameId), `game ${gameId} does not exist`);
    for (const c of file.claims) {
      if (c.gameId !== gameId) add('D-03', claimFile(gameId), `claim ${c.id} belongs to ${c.gameId}`);
      if (c.field === 'tag' && !tagIds.has(c.value.tagId))
        add('D-03', claimFile(gameId), `tag ${c.value.tagId} does not exist`);
    }
  }
  for (const a of data.articles) {
    for (const g of a.games) {
      if (!gameById.has(g.gameId)) add('D-03', `data/articles/${a.id}.json`, `game ${g.gameId} does not exist`);
    }
    if (a.image && !fs.existsSync(path.join(PROJECT_ROOT, 'public', a.image.path))) {
      add('D-03', `data/articles/${a.id}.json`, `image public/${a.image.path} does not exist`);
    }
  }
  for (const ev of data.events) {
    for (const id of ev.games) {
      if (!gameById.has(id)) add('D-03', `data/events/${ev.id}.json`, `game ${id} does not exist`);
    }
    const expected = eventId(ev.url, startOf(ev.start));
    if (ev.id !== expected) add('D-08', `data/events/${ev.id}.json`, `event id should be ${expected}`);
  }
  for (const col of data.collections) {
    for (const item of col.items) {
      if (!gameById.has(item.gameId))
        add('D-03', `data/collections/${col.id}.json`, `game ${item.gameId} does not exist`);
    }
  }
  for (const r of data.relations.relations) {
    for (const id of [r.a, r.b]) {
      if (!gameById.has(id)) add('D-03', 'data/relations/game-relations.json', `game ${id} does not exist`);
    }
  }

  // D-04: 統合済みの作品
  const merged = new Set(data.games.filter((g) => g.status === 'merged').map((g) => g.id));
  for (const g of data.games) {
    if (g.status !== 'merged' || !g.mergedInto) continue;
    const target = gameById.get(g.mergedInto);
    if (target?.status === 'merged') add('D-04', gameFile(g.id), `mergedInto ${g.mergedInto} is itself merged (chain)`);
    if (claimsOf(g.id).some((c) => c.status === 'adopted'))
      add('D-04', claimFile(g.id), 'merged game has adopted claims');
  }
  for (const a of data.articles) {
    for (const g of a.games) {
      if (merged.has(g.gameId)) add('D-04', `data/articles/${a.id}.json`, `links merged game ${g.gameId}`);
    }
  }
  for (const col of data.collections) {
    for (const i of col.items) {
      if (merged.has(i.gameId)) add('D-04', `data/collections/${col.id}.json`, `contains merged game ${i.gameId}`);
    }
  }
  for (const r of data.relations.relations) {
    if (merged.has(r.a) || merged.has(r.b))
      add('D-04', 'data/relations/game-relations.json', `relation ${r.id} uses a merged game`);
  }

  // D-05: 強いキーが重複しない
  const keyOwner = new Map<string, string>();
  const active = data.games.filter((g) => g.status !== 'merged');
  for (const g of active) {
    for (const k of strongKeys(g)) {
      const owner = keyOwner.get(k);
      if (owner && owner !== g.id) add('D-05', gameFile(g.id), `strong key ${k} is also used by ${owner}`);
      else keyOwner.set(k, g.id);
    }
  }
  for (const g of active) {
    for (const k of associatedAppKeys(g)) {
      const owner = keyOwner.get(k);
      if (owner) add('D-05', gameFile(g.id), `associated app ${k} is a strong key of ${owner}`);
    }
  }

  // D-06: 公開中の作品が公開の条件を満たす
  for (const g of data.games) {
    if (g.status !== 'published') continue;
    const r = canPublish(g, claimsOf(g.id), data.tasks.tasks, data.developers);
    if (!r.ok) add('D-06', gameFile(g.id), `published game fails ${r.failed.join(', ')}`);
  }

  // D-07: Claim の ID と、値が1つの項目の採用数
  for (const [gameId, file] of data.claims) {
    const adoptedByScope = new Map<string, number>();
    for (const c of file.claims) {
      const expected = claimId(c.gameId, c.field, c.scope, c.value);
      if (c.id !== expected) add('D-07', claimFile(gameId), `claim id ${c.id} should be ${expected}`);
      if (c.status === 'superseded' && !c.supersededBy)
        add('D-07', claimFile(gameId), `superseded claim ${c.id} has no supersededBy`);
      if (c.status === 'adopted' && SINGLE_VALUE_FIELDS.includes(c.field)) {
        const key = `${c.field}|${scopeKey(c.scope)}`;
        adoptedByScope.set(key, (adoptedByScope.get(key) ?? 0) + 1);
      }
    }
    for (const [key, n] of adoptedByScope) {
      if (n > 1) add('D-07', claimFile(gameId), `${n} adopted claims for ${key}`);
    }
  }

  // D-08: 記事の ID
  for (const a of data.articles) {
    const expected = articleId(a.canonicalUrl);
    if (a.id !== expected) add('D-08', `data/articles/${a.id}.json`, `article id should be ${expected}`);
  }

  // D-09: 公開中のコレクション
  for (const col of data.collections) {
    if (col.status !== 'published') continue;
    const file = `data/collections/${col.id}.json`;
    if (col.items.length < MIN_PUBLISHED_COLLECTION_ITEMS) {
      add('D-09', file, `published collection has ${col.items.length} items (< ${MIN_PUBLISHED_COLLECTION_ITEMS})`);
    }
    for (const item of col.items) {
      const g = gameById.get(item.gameId);
      if (g && g.status !== 'published') add('D-09', file, `${item.gameId} is not published`);
      const claims = claimsOf(item.gameId);
      if (!matchesRules(claimsView(claims), col.criteria.rules))
        add('D-09', file, `${item.gameId} does not satisfy rules`);
      const adoptedIds = new Set(claims.filter((c) => c.status === 'adopted').map((c) => c.id));
      for (const id of item.evidenceClaimIds) {
        if (!adoptedIds.has(id)) add('D-09', file, `${id} is not an adopted claim of ${item.gameId}`);
      }
    }
  }

  // D-10: 作品間の関係
  const relKeys = new Set<string>();
  for (const r of data.relations.relations) {
    const file = 'data/relations/game-relations.json';
    if (!(r.a < r.b)) add('D-10', file, `relation ${r.id}: a must be less than b`);
    const key = `${r.a}|${r.b}|${r.kind}`;
    if (relKeys.has(key)) add('D-10', file, `duplicate relation ${key}`);
    relKeys.add(key);
    if (r.id !== relationId(r.a, r.b, r.kind)) add('D-10', file, `relation id ${r.id} does not match`);
  }

  // D-11: タグ
  const seenTag = new Set<string>();
  const labelOwner = new Map<string, string>();
  for (const t of data.tags.tags) {
    const file = 'data/taxonomy/tags.json';
    if (seenTag.has(t.id)) add('D-11', file, `duplicate tag id ${t.id}`);
    seenTag.add(t.id);
    if (t.mergedInto && !tagIds.has(t.mergedInto))
      add('D-11', file, `tag ${t.id}: mergedInto ${t.mergedInto} does not exist`);
    if (t.status === 'deprecated') continue;
    const names = new Set([t.label.ja, t.label.en, ...t.aliases].map(normalizeTitle).filter(Boolean));
    for (const n of names) {
      const owner = labelOwner.get(n);
      if (owner && owner !== t.id) add('D-11', file, `label or alias "${n}" of ${t.id} collides with ${owner}`);
      else labelOwner.set(n, t.id);
    }
  }

  // D-12: タスクとレビュー待ち
  const taskIds = new Set<string>();
  for (const t of data.tasks.tasks) {
    if (taskIds.has(t.id)) add('D-12', 'state/tasks.json', `duplicate task id ${t.id}`);
    taskIds.add(t.id);
    if ((t.status === 'done' || t.status === 'dropped') && !t.resolution) {
      add('D-12', 'state/tasks.json', `task ${t.id} is ${t.status} without resolution`);
    }
    if (t.status === 'open' && t.resolution) add('D-12', 'state/tasks.json', `open task ${t.id} has a resolution`);
    if (t.status === 'blocked' && !t.blockedReason && !t.recheck) {
      add('D-12', 'state/tasks.json', `blocked task ${t.id} has neither blockedReason nor recheck`);
    }
  }
  const reviewIds = new Set<string>();
  for (const r of data.reviewQueue.items) {
    if (reviewIds.has(r.id)) add('D-12', 'state/review-queue.json', `duplicate review id ${r.id}`);
    reviewIds.add(r.id);
    if (r.status !== 'open' && !r.decidedAt)
      add('D-12', 'state/review-queue.json', `review ${r.id} is ${r.status} without decidedAt`);
  }

  // D-13: 有効な情報源は利用条件を確認済み
  for (const s of data.sources.sources) {
    if (s.enabled && !s.rights.checkedAt)
      add('D-13', 'config/sources.json', `enabled source ${s.id} has no rights.checkedAt`);
  }

  return issues;
}

export function checkData(): CheckIssue[] {
  const { issues, data } = checkFiles();
  if (data) issues.push(...checkConsistency(data));
  return issues;
}

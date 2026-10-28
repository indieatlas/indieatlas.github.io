import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { z } from 'zod';
import { Article } from '../../schema/article.ts';
import { ClaimsFile } from '../../schema/claim.ts';
import { Collection } from '../../schema/collection.ts';
import { RuntimeConfig, SourcesFile } from '../../schema/config.ts';
import { Developer } from '../../schema/developer.ts';
import { IndieEvent } from '../../schema/event.ts';
import { Game } from '../../schema/game.ts';
import { ImagePalettes, PopularityMetrics, ReviewSummaries } from '../../schema/media.ts';
import { GameRelationsFile } from '../../schema/relation.ts';
import { ReviewQueue, RunsFile, SeenUrls, SourceState, TasksFile, UsageLedger } from '../../schema/state.ts';
import { TagsFile } from '../../schema/taxonomy.ts';
import {
  sortArticle,
  sortClaimsFile,
  sortCollection,
  sortGame,
  sortRelations,
  sortReviewQueue,
  sortRuns,
  sortEvent,
  sortPalettes,
  sortPopularity,
  sortReviewSummaries,
  sortSeenUrls,
  sortTags,
  sortTasks,
} from './sort.ts';

/** リポジトリの直下（このファイルから2つ上） */
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** data/、state/、config/ を読み書きする場所。INDIEATLAS_ROOT で変えられる（03 §3.5.1） */
export function repoRoot(): string {
  const env = process.env.INDIEATLAS_ROOT;
  return env ? path.resolve(PROJECT_ROOT, env) : PROJECT_ROOT;
}

export function repoPath(...parts: string[]): string {
  return path.join(repoRoot(), ...parts);
}

/** schema.parse の結果を、2スペースの字下げと末尾の改行1つで文字列にする */
export function formatJson<S extends z.ZodType>(schema: S, value: z.input<S>): string {
  return JSON.stringify(schema.parse(value), null, 2) + '\n';
}

/** JSON の書き込みは必ずこの関数を通す（04 §4.1.1） */
export function writeJson<S extends z.ZodType>(schema: S, file: string, value: z.input<S>): void {
  const text = formatJson(schema, value);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

export function readJson<S extends z.ZodType>(schema: S, file: string): z.output<S> {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return schema.parse(raw);
}

export function readJsonIfExists<S extends z.ZodType>(schema: S, file: string): z.output<S> | undefined {
  return fs.existsSync(file) ? readJson(schema, file) : undefined;
}

export function listJsonFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => path.join(dir, f));
}

/** 正規化した JSON のファイルの種類。check:data の D-01、D-02 と、書き込みの並び替えに使う */
export interface FileKind<S extends z.ZodType = z.ZodType> {
  name: string;
  /** repoRoot からの相対パス。ディレクトリなら dir、単一のファイルなら file */
  dir?: string;
  file?: string;
  schema: S;
  sort: (v: z.output<S>) => z.output<S>;
  /** ファイル名（拡張子なし）と一致すべき ID */
  idOf?: (v: z.output<S>) => string;
  /** ファイルがなくてもよいか */
  optional?: boolean;
}

const identity = <T>(v: T) => v;

function defineKind<S extends z.ZodType>(k: FileKind<S>): FileKind {
  return k as unknown as FileKind;
}

export const FILE_KINDS: FileKind[] = [
  defineKind({ name: 'game', dir: 'data/games', schema: Game, sort: sortGame, idOf: (v) => v.id }),
  defineKind({ name: 'claims', dir: 'data/claims', schema: ClaimsFile, sort: sortClaimsFile, idOf: (v) => v.gameId }),
  defineKind({ name: 'article', dir: 'data/articles', schema: Article, sort: sortArticle, idOf: (v) => v.id }),
  defineKind({ name: 'event', dir: 'data/events', schema: IndieEvent, sort: sortEvent, idOf: (v) => v.id }),
  defineKind({ name: 'developer', dir: 'data/developers', schema: Developer, sort: identity, idOf: (v) => v.id }),
  defineKind({
    name: 'collection',
    dir: 'data/collections',
    schema: Collection,
    sort: sortCollection,
    idOf: (v) => v.id,
  }),
  defineKind({
    name: 'relations',
    file: 'data/relations/game-relations.json',
    schema: GameRelationsFile,
    sort: sortRelations,
  }),
  defineKind({ name: 'tags', file: 'data/taxonomy/tags.json', schema: TagsFile, sort: sortTags }),
  defineKind({ name: 'palettes', file: 'data/media/palettes.json', schema: ImagePalettes, sort: sortPalettes }),
  defineKind({
    name: 'review-summaries',
    file: 'data/metrics/review-summaries.json',
    schema: ReviewSummaries,
    sort: sortReviewSummaries,
  }),
  defineKind({
    name: 'popularity',
    file: 'data/metrics/popularity.json',
    schema: PopularityMetrics,
    sort: sortPopularity,
  }),
  defineKind({
    name: 'source-state',
    dir: 'state/sources',
    schema: SourceState,
    sort: identity,
    idOf: (v) => v.sourceId,
  }),
  defineKind({ name: 'tasks', file: 'state/tasks.json', schema: TasksFile, sort: sortTasks }),
  defineKind({ name: 'tasks-archive', dir: 'state/tasks-archive', schema: TasksFile, sort: sortTasks }),
  defineKind({ name: 'seen-urls', file: 'state/seen-urls.json', schema: SeenUrls, sort: sortSeenUrls }),
  defineKind({ name: 'review-queue', file: 'state/review-queue.json', schema: ReviewQueue, sort: sortReviewQueue }),
  defineKind({ name: 'runs', dir: 'state/runs', schema: RunsFile, sort: sortRuns }),
  defineKind({ name: 'usage', dir: 'state/usage', schema: UsageLedger, sort: identity, idOf: (v) => v.month }),
  defineKind({ name: 'runtime', file: 'config/runtime.json', schema: RuntimeConfig, sort: identity }),
  defineKind({ name: 'sources', file: 'config/sources.json', schema: SourcesFile, sort: identity }),
];

export function fileKind(name: string): FileKind {
  const k = FILE_KINDS.find((f) => f.name === name);
  if (!k) throw new Error(`unknown file kind: ${name}`);
  return k;
}

/** 並び替えてから書く */
export function writeKind<S extends z.ZodType>(kind: FileKind<S>, file: string, value: z.output<S>): void {
  writeJson(kind.schema, file, kind.sort(kind.schema.parse(value)) as z.input<S>);
}

export interface RepoData {
  games: Game[];
  claims: Map<string, ClaimsFile>;
  articles: Article[];
  developers: Developer[];
  events: IndieEvent[];
  collections: Collection[];
  relations: GameRelationsFile;
  tags: TagsFile;
  palettes: ImagePalettes;
  popularity: PopularityMetrics;
  reviewSummaries: ReviewSummaries;
  tasks: TasksFile;
  reviewQueue: ReviewQueue;
  seenUrls: SeenUrls;
  sources: SourcesFile;
  runtime: RuntimeConfig;
}

function readDir<S extends z.ZodType>(rel: string, schema: S): z.output<S>[] {
  return listJsonFiles(repoPath(rel)).map((f) => readJson(schema, f));
}

/** data/、state/、config/ を読み込む。ファイルがない単一のファイルは空として扱う */
export function loadRepo(): RepoData {
  const claims = new Map<string, ClaimsFile>();
  for (const c of readDir('data/claims', ClaimsFile)) claims.set(c.gameId, c);
  return {
    games: readDir('data/games', Game),
    claims,
    articles: readDir('data/articles', Article),
    developers: readDir('data/developers', Developer),
    events: readDir('data/events', IndieEvent),
    collections: readDir('data/collections', Collection),
    relations: readJsonIfExists(GameRelationsFile, repoPath('data/relations/game-relations.json')) ?? {
      schemaVersion: 1,
      relations: [],
    },
    tags: readJsonIfExists(TagsFile, repoPath('data/taxonomy/tags.json')) ?? { schemaVersion: 1, tags: [] },
    palettes: readJsonIfExists(ImagePalettes, repoPath('data/media/palettes.json')) ?? {
      schemaVersion: 1,
      entries: {},
    },
    popularity: readJsonIfExists(PopularityMetrics, repoPath('data/metrics/popularity.json')) ?? {
      schemaVersion: 1,
      entries: {},
    },
    reviewSummaries: readJsonIfExists(ReviewSummaries, repoPath('data/metrics/review-summaries.json')) ?? {
      schemaVersion: 1,
      entries: {},
    },
    tasks: readJsonIfExists(TasksFile, repoPath('state/tasks.json')) ?? { schemaVersion: 1, tasks: [] },
    reviewQueue: readJsonIfExists(ReviewQueue, repoPath('state/review-queue.json')) ?? { schemaVersion: 1, items: [] },
    seenUrls: readJsonIfExists(SeenUrls, repoPath('state/seen-urls.json')) ?? { schemaVersion: 1, entries: {} },
    sources: readJsonIfExists(SourcesFile, repoPath('config/sources.json')) ?? { schemaVersion: 1, sources: [] },
    runtime: readJson(RuntimeConfig, repoPath('config/runtime.json')),
  };
}

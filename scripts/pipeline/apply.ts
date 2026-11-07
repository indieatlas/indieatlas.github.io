import { titleIssues } from './title-translation.ts';
import type { Article } from '../../schema/article.ts';
import type { Claim, ClaimsFile, Evidence } from '../../schema/claim.ts';
import type { Developer } from '../../schema/developer.ts';
import type { IndieEvent } from '../../schema/event.ts';
import type { Game } from '../../schema/game.ts';
import {
  ALLOWED_OPERATIONS,
  FIX_TASKS,
  TARGET_ONLY_TASKS,
  type ClaimDraft,
  type DeveloperRef,
  type EvidenceDraft,
  type GameRef,
  type Operation,
  type TaskResult,
} from '../../schema/proposal.ts';
import type { Task } from '../../schema/state.ts';
import { canonicalJson } from '../lib/canonical-json.ts';
import { makeClaim, upsertClaim } from '../lib/claim-builder.ts';
import { adoptedOf, claimsView, matchesRules } from '../lib/claims-view.ts';
import { canBeOfficialSite, registrableDomain } from '../lib/domains.ts';
import { articleId, eventId, nextNumericId, relationId, reviewId, urlKey } from '../lib/ids.ts';
import { startOf } from '../lib/partial-date.ts';
import type { RepoData } from '../lib/repo-io.ts';
import { normalizeTitle } from '../lib/text-normalize.ts';
import { normalizeUrl } from '../lib/url-normalize.ts';
import { storeUrl } from '../sources/steam.ts';
import { matchGame, type IdentityInput } from './identity.ts';
import { assessIndie } from './publish-rules.ts';
import { tier, valueKey } from './resolve.ts';
import { addDays, makeTask } from './tasks.ts';
import { eventDatesSupported } from './validate/event-dates.ts';
import {
  basisOk,
  checkEvidence,
  toEvidence,
  type EvidenceContext,
  type FetchLogIndex,
  type Subject,
  type Violation,
} from './validate/evidence.ts';
import { textIssues } from './validate/text-rules.ts';

/**
 * 提案の検証と反映（06 §6.7、§6.11 の手順6）。1つの TaskResult の操作を決まった順に検証し、通ったものだけを
 * 作業用のデータ（Workspace）に反映する。Claim の採用の計算（resolve.ts）と公開の判定は adopt-core.ts が後で行う。
 */

export interface Workspace {
  repo: RepoData;
  at: string; // UTC
  today: string; // 日本時間の暦日
  runId: string;
  log: FetchLogIndex;
  dirty: {
    games: Set<string>;
    claims: Set<string>;
    articles: Set<string>;
    events: Set<string>;
    eventsDeleted: Set<string>;
    developers: Set<string>;
    collections: Set<string>;
    relations: boolean;
    tags: boolean;
    tasks: boolean;
    reviewQueue: boolean;
    seenUrls: boolean;
  };
  newClaimIds: Map<string, Set<string>>; // 作品ごとの、この実行で加えた Claim
  createdGames: string[];
  newArticles: string[];
  newEvents: string[];
  steamToRefresh: Set<string>; // ストアの情報を取り込む作品（新しく作ったもの）
  newTasks: Task[];
  counts: {
    claimsAdded: number;
    relationsAdded: number;
    collectionsChanged: number;
    articlesLinked: number;
  };
  rejections: Map<string, number>;
  rejectionLog: { taskId: string; op: string; rule: string; message: string }[];
  pending: string[];
}

export function createWorkspace(
  repo: RepoData,
  opts: { at: string; today: string; runId: string; log: FetchLogIndex },
): Workspace {
  return {
    repo,
    ...opts,
    dirty: {
      games: new Set(),
      claims: new Set(),
      articles: new Set(),
      events: new Set(),
      eventsDeleted: new Set(),
      developers: new Set(),
      collections: new Set(),
      relations: false,
      tags: false,
      tasks: false,
      reviewQueue: false,
      seenUrls: false,
    },
    newClaimIds: new Map(),
    createdGames: [],
    newArticles: [],
    newEvents: [],
    steamToRefresh: new Set(),
    newTasks: [],
    counts: { claimsAdded: 0, relationsAdded: 0, collectionsChanged: 0, articlesLinked: 0 },
    rejections: new Map(),
    rejectionLog: [],
    pending: [],
  };
}

class Rejected extends Error {
  constructor(
    readonly rule: string,
    message: string,
  ) {
    super(message);
  }
}
const reject = (rule: string, message: string): never => {
  throw new Rejected(rule, message);
};

export function addTask(ws: Workspace, t: Task): void {
  if (ws.newTasks.some((x) => x.id === t.id)) return;
  const prev = ws.repo.tasks.tasks.find((x) => x.id === t.id);
  if (prev && prev.status !== 'done' && prev.status !== 'dropped') return;
  ws.newTasks.push(t);
}

// 反映の順（06 §6.11 の手順6）
const ORDER: Operation['op'][] = [
  'upsert-developer',
  'create-game',
  'update-identity',
  'upsert-article',
  'add-claim',
  'confirm-claim',
  'retract-claim',
  'add-relation',
  'collection-add',
  'collection-remove',
  'propose-tag',
  'upsert-event',
  'propose-merge',
  'propose-tag-change',
  'create-collection-draft',
];

interface ResultContext {
  ws: Workspace;
  task: Task;
  taskId: string;
  temp: Map<string, string | null>; // 一時 ID → 作品 ID（却下したら null）
  createdHere: Set<string>; // この結果で作った作品
}

// ------------------------------------------------------------------ 参照と根拠

function gameById(ws: Workspace, id: string): Game | undefined {
  return ws.repo.games.find((g) => g.id === id);
}

function resolveRef(c: ResultContext, ref: GameRef): string {
  if ('gameId' in ref) {
    if (!gameById(c.ws, ref.gameId)) reject('V-S02', `game ${ref.gameId} does not exist`);
    return ref.gameId;
  }
  const id = c.temp.get(ref.tempId);
  if (id === undefined) reject('V-S02', `temp id ${ref.tempId} is not defined in this result`);
  if (id === null) reject('V-S02', `temp id ${ref.tempId} was rejected`);
  return id!;
}

/** V-S03、V-S05: 変更してよい作品か */
function assertWritable(c: ResultContext, gameId: string): Game {
  const g = gameById(c.ws, gameId)!;
  if (g.status === 'merged') reject('V-S03', `${gameId} is merged`);
  if (g.status === 'hidden' && !FIX_TASKS.includes(c.task.type)) reject('V-S03', `${gameId} is hidden`);
  if (
    TARGET_ONLY_TASKS.includes(c.task.type) &&
    c.task.target.gameId &&
    c.task.target.gameId !== gameId &&
    !c.createdHere.has(gameId)
  ) {
    reject('V-S05', `${gameId} is not the target of the task`);
  }
  return g;
}

function developerNames(ws: Workspace, ids: string[]): string[] {
  return ids.flatMap((id) => {
    const d = ws.repo.developers.find((x) => x.id === id);
    return d ? [d.name.display, d.name.original, ...d.aliases] : [];
  });
}

function subjectOf(ws: Workspace, g: Game): Subject {
  return {
    names: [g.title.display, g.title.original, ...g.aliases.map((a) => a.value)],
    steamAppIds: [
      ...(g.externalIds.steamAppId ? [g.externalIds.steamAppId] : []),
      ...g.associatedApps.filter((a) => a.store === 'steam').map((a) => Number(a.id)),
    ],
    urls: [
      ...(g.officialUrl ? [g.officialUrl] : []),
      ...(g.externalIds.steamAppId ? [storeUrl(g.externalIds.steamAppId)] : []),
      ...(g.externalIds.itchUrl ? [g.externalIds.itchUrl] : []),
    ],
  };
}

function evidenceContext(ws: Workspace, officialUrls: string[]): EvidenceContext {
  return {
    log: ws.log,
    sources: ws.repo.sources.sources,
    officialUrls,
    maxQuoteChars: ws.repo.runtime.evidence.maxQuoteChars,
    storeQuotesDefault: ws.repo.runtime.evidence.storeQuotes,
    articleFor: (url) => {
      const k = urlKey(url);
      const a = ws.repo.articles.find((x) => [x.url, x.canonicalUrl, ...x.urlAliases].some((u) => urlKey(u) === k));
      return a ? { id: a.id, ...(a.derivedFrom ? { derivedFromKey: a.derivedFrom.key } : {}) } : undefined;
    },
  };
}

function officialUrlsOf(ws: Workspace, g: Pick<Game, 'officialUrl' | 'developerIds' | 'publisherIds'>): string[] {
  return [
    ...(g.officialUrl ? [g.officialUrl] : []),
    ...[...g.developerIds, ...g.publisherIds].flatMap((id) => {
      const d = ws.repo.developers.find((x) => x.id === id);
      return d?.officialUrl ? [d.officialUrl] : [];
    }),
  ];
}

/** 根拠を検証して変換する。通らない根拠は捨て、1件も残らなければ却下する */
function evidenceFor(
  c: ResultContext,
  drafts: EvidenceDraft[],
  subject: Subject | undefined,
  ctx: EvidenceContext,
  opName: string,
): Evidence[] {
  const out: Evidence[] = [];
  let first: Violation | undefined;
  for (const d of drafts) {
    const v = checkEvidence(d, subject, ctx);
    if (v) {
      first ??= v;
      count(c.ws, c.taskId, opName, v.rule, `${v.message}（根拠を1件除いた）`);
      continue;
    }
    out.push(toEvidence(d, ctx));
  }
  if (out.length === 0) reject(first?.rule ?? 'V-E01', first?.message ?? 'no evidence');
  return out;
}

function count(ws: Workspace, taskId: string, op: string, rule: string, message: string): void {
  ws.rejections.set(rule, (ws.rejections.get(rule) ?? 0) + 1);
  if (ws.rejectionLog.length < 500) ws.rejectionLog.push({ taskId, op, rule, message: message.slice(0, 300) });
}

function assertText(text: string, rule = 'V-C01', allowMarkdown = false): void {
  const issues = textIssues(text, { allowMarkdown });
  if (issues.length)
    reject(rule, `forbidden expression: ${issues.map((i) => `${i.category}「${i.match}」`).join(', ')}`);
}

/** 個人開発と小規模な体制は「公式に明記されている」ことが条件なので、公式かストアの根拠が要る（04 §4.4.3） */
const OFFICIAL_ONLY_REASONS = new Set(['solo-developer', 'small-team', 'large-studio', 'subsidiary']);
function reasonEvidenceOk(code: string, evidence: Evidence[]): boolean {
  return !OFFICIAL_ONLY_REASONS.has(code) || evidence.some((e) => e.kind === 'official' || e.kind === 'store');
}

function steamLog(ws: Workspace, appId: number) {
  return ws.log.entries.find((e) => e.steam && Number(e.steam.appId) === appId)?.steam;
}

// ------------------------------------------------------------------ 開発者

function findDeveloper(ws: Workspace, name: string): Developer | undefined {
  const k = normalizeTitle(name);
  return ws.repo.developers.find((d) =>
    [d.name.display, d.name.original, ...d.aliases].some((n) => normalizeTitle(n) === k),
  );
}

function resolveDeveloper(c: ResultContext, ref: DeveloperRef, role: 'developer' | 'publisher' | undefined): string {
  const ws = c.ws;
  if ('developerId' in ref) {
    if (!ws.repo.developers.some((d) => d.id === ref.developerId))
      reject('V-S02', `developer ${ref.developerId} does not exist`);
    return ref.developerId;
  }
  let d = findDeveloper(ws, ref.name);
  if (!d) {
    d = {
      schemaVersion: 1,
      id: nextNumericId(
        'developer',
        ws.repo.developers.map((x) => x.id),
      ),
      name: { display: ref.name, original: ref.name },
      aliases: [],
      roles: [role ?? 'developer'],
      ...(ref.officialUrl && canBeOfficialSite(ref.officialUrl) ? { officialUrl: ref.officialUrl } : {}),
      links: [],
      independence: { status: 'unknown', setBy: 'llm', evidence: [] },
      createdAt: ws.at,
      updatedAt: ws.at,
      createdByRun: ws.runId,
    };
    ws.repo.developers.push(d);
    ws.dirty.developers.add(d.id);
  } else if (role && !d.roles.includes(role)) {
    d.roles = [...d.roles, role].sort() as Developer['roles'];
    d.updatedAt = ws.at;
    ws.dirty.developers.add(d.id);
  }
  return d.id;
}

function applyUpsertDeveloper(c: ResultContext, op: Extract<Operation, { op: 'upsert-developer' }>): void {
  const ws = c.ws;
  const id = resolveDeveloper(c, op.developer, undefined);
  const d = ws.repo.developers.find((x) => x.id === id)!;
  const subject: Subject = {
    names: [d.name.display, d.name.original, ...d.aliases],
    steamAppIds: [],
    urls: d.officialUrl ? [d.officialUrl] : [],
  };
  const evidence = evidenceFor(
    c,
    op.evidence,
    subject,
    evidenceContext(ws, d.officialUrl ? [d.officialUrl] : []),
    op.op,
  );
  const ch = op.changes;
  if (ch.addAliases) d.aliases = [...new Set([...d.aliases, ...ch.addAliases])].slice(0, 20);
  if (ch.setOfficialUrl && !d.officialUrl && canBeOfficialSite(ch.setOfficialUrl)) d.officialUrl = ch.setOfficialUrl;
  if (ch.addLinks) {
    const known = new Set(d.links.map((l) => l.url));
    d.links = [...d.links, ...ch.addLinks.filter((l) => !known.has(l.url))].slice(0, 20);
  }
  if (ch.proposeIndependence) {
    if (ch.proposeIndependence === 'independent' || ch.proposeIndependence === 'major') {
      // 独立系と大手の判定は人の判断を待つ（V-L04）
      queueReview(c, 'developer-independence', op, `${d.name.display} を ${ch.proposeIndependence} とする提案`);
    } else if (d.independence.setBy !== 'human') {
      d.independence = { status: ch.proposeIndependence, setBy: 'llm', evidence: evidence.slice(0, 5) };
    }
  }
  d.updatedAt = ws.at;
  ws.dirty.developers.add(d.id);
}

// ------------------------------------------------------------------ 作品の作成と識別情報

function applyCreateGame(c: ResultContext, op: Extract<Operation, { op: 'create-game' }>): void {
  const ws = c.ws;
  const idn = op.identity;
  const externalIds = { ...idn.externalIds };
  const associatedApps = [...idn.associatedApps];
  // V-I03: Steam のアプリ ID は本編のものだけ。体験版や DLC は associatedApps に移す
  if (externalIds.steamAppId) {
    const s = steamLog(ws, externalIds.steamAppId);
    if (s?.adult) reject('V-I05', `${externalIds.steamAppId} has adult sexual content descriptors`);
    if (s && s.type !== 'game') {
      const kind = s.type === 'demo' ? 'demo' : s.type === 'dlc' ? 'dlc' : s.type === 'music' ? 'soundtrack' : 'other';
      associatedApps.push({ store: 'steam', id: String(externalIds.steamAppId), kind });
      const full = Number(s.fullgameAppId);
      if (full > 0) externalIds.steamAppId = full;
      else delete externalIds.steamAppId;
      count(ws, c.taskId, op.op, 'V-I03', `${s.appId} is ${s.type}; moved to associatedApps`);
    }
  }
  const officialUrl = idn.officialUrl && canBeOfficialSite(idn.officialUrl) ? idn.officialUrl : undefined;
  const draftGame = {
    title: idn.title,
    aliases: idn.aliases,
    externalIds,
    associatedApps,
    ...(officialUrl ? { officialUrl } : {}),
  };
  const subject: Subject = {
    names: [idn.title.display, idn.title.original, ...idn.aliases.map((a) => a.value)],
    steamAppIds: [
      ...(externalIds.steamAppId ? [externalIds.steamAppId] : []),
      ...associatedApps.filter((a) => a.store === 'steam').map((a) => Number(a.id)),
    ],
    urls: [
      ...(officialUrl ? [officialUrl] : []),
      ...(externalIds.steamAppId ? [storeUrl(externalIds.steamAppId)] : []),
    ],
  };

  // V-I02: 既存の作品との照合
  const devNames = idn.developers.map((d) =>
    'name' in d ? d.name : (ws.repo.developers.find((x) => x.id === d.developerId)?.name.display ?? ''),
  );
  const match = c.ws.repo.games.length
    ? matchExisting(ws, {
        titles: subject.names,
        developerNames: devNames,
        externalIds,
        ...(officialUrl ? { officialUrl } : {}),
      })
    : ({ kind: 'none', sameNameGameIds: [] } as const);
  if (match.kind === 'match') {
    c.temp.set(op.tempId, match.gameId);
    const g = gameById(ws, match.gameId)!;
    // 同じ提案の識別情報は「追加だけ」の更新として扱う
    const known = new Set([g.title.display, g.title.original, ...g.aliases.map((a) => a.value)].map(normalizeTitle));
    const extra = idn.aliases.filter((a) => !known.has(normalizeTitle(a.value)));
    if (extra.length && g.status !== 'merged') {
      g.aliases = [...g.aliases, ...extra].slice(0, 30);
      g.updatedAt = ws.at;
      ws.dirty.games.add(g.id);
    }
    return;
  }
  if (match.kind === 'probable') {
    c.temp.set(op.tempId, null);
    addTask(
      ws,
      makeTask(
        'fix-duplicate',
        {
          gameId: match.gameId,
          name: idn.title.display.slice(0, 120),
          hints: [`new:${idn.title.original}`.slice(0, 200)],
        },
        `「${idn.title.display}」が ${match.gameId} と同じ作品かを確かめる`,
        'validator',
        ws.at,
      ),
    );
    reject('V-I02', `probably the same as ${match.gameId}`);
  }
  if (match.kind === 'ambiguous') {
    c.temp.set(op.tempId, null);
    const t = makeTask(
      'register-game',
      {
        name: idn.title.display.slice(0, 120),
        hints: [...match.gameIds, ...devNames].slice(0, 10).map((h) => h.slice(0, 200)),
      },
      `「${idn.title.display}」を既存の作品（${match.gameIds.join('、')}）と区別できる根拠を集めて登録する`,
      'validator',
      ws.at,
    );
    addTask(ws, {
      ...t,
      status: 'blocked',
      blockedReason: `同名または似た名前の作品がある: ${match.gameIds.join(', ')}`,
      recheck: { after: addDays(ws.today, 14) },
    });
    reject('V-I02', `ambiguous with ${match.gameIds.join(', ')}`);
  }

  // V-L01: 1回の実行で作る作品の上限
  if (ws.createdGames.length >= ws.repo.runtime.limits.maxNewGames) {
    c.temp.set(op.tempId, null);
    const hint = externalIds.steamAppId ? `steam:${externalIds.steamAppId}` : (officialUrl ?? '');
    // 記事のタスクから来た作品は、次の回に記事も関連づけられるよう、記事の URL を対象に入れる
    const articleUrl = c.task.type === 'process-article' ? c.task.target.url : undefined;
    addTask(
      ws,
      makeTask(
        'register-game',
        {
          name: idn.title.display.slice(0, 120),
          ...(hint ? { hints: [hint] } : {}),
          ...(articleUrl ? { url: articleUrl } : {}),
        },
        articleUrl
          ? `「${idn.title.display}」を登録し、記事（target.url）に関連づける`
          : `「${idn.title.display}」を登録する`,
        'validator',
        ws.at,
      ),
    );
    reject('V-L01', 'too many new games in this run');
  }

  // 識別の根拠（V-I01）
  const ctx = evidenceContext(ws, officialUrl ? [officialUrl] : []);
  const identityEvidence: Game['identityEvidence'] = [];
  for (const e of idn.evidence) {
    const v = checkEvidence(e.evidence, subject, ctx);
    if (v) {
      count(ws, c.taskId, op.op, v.rule, `${v.message}（識別の根拠を1件除いた）`);
      continue;
    }
    identityEvidence.push({ field: e.field, evidence: toEvidence(e.evidence, ctx) });
  }
  const hasStrong = Object.values(externalIds).some((v) => v !== undefined);
  const identified =
    (officialUrl && identityEvidence.some((e) => e.field === 'officialUrl')) ||
    (hasStrong && identityEvidence.some((e) => e.field === 'externalIds'));
  if (!identified) {
    c.temp.set(op.tempId, null);
    reject('V-I01', 'create-game needs an official URL or a strong key with evidence');
  }
  if (
    externalIds.steamAppId &&
    !steamLog(ws, externalIds.steamAppId) &&
    !identityEvidence.some(
      (e) => e.field === 'externalIds' && e.evidence.url.includes(`/app/${externalIds.steamAppId}`),
    )
  ) {
    c.temp.set(op.tempId, null);
    reject('V-I01', `steam app ${externalIds.steamAppId} was not confirmed with get_steam_app`);
  }

  const id = nextNumericId(
    'game',
    ws.repo.games.map((g) => g.id),
  );
  const developerIds = [...new Set(idn.developers.map((d) => resolveDeveloper(c, d, 'developer')))];
  const publisherIds = [...new Set(idn.publishers.map((d) => resolveDeveloper(c, d, 'publisher')))];
  const reasons: Game['indie']['reasons'] = [];
  const reasonCtx = evidenceContext(
    ws,
    officialUrlsOf(ws, { ...(officialUrl ? { officialUrl } : {}), developerIds, publisherIds }),
  );
  for (const r of idn.indieReasons) {
    const ev: Evidence[] = [];
    for (const d of r.evidence) {
      const v = checkEvidence(d, undefined, reasonCtx);
      if (v) count(ws, c.taskId, op.op, v.rule, `${v.message}（インディーの理由の根拠を除いた）`);
      else ev.push(toEvidence(d, reasonCtx));
    }
    if (ev.length && !reasonEvidenceOk(r.code, ev)) {
      count(ws, c.taskId, op.op, 'V-E05', `${r.code} needs official or store evidence（インディーの理由を除いた）`);
      continue;
    }
    if (ev.length) reasons.push({ code: r.code, ...(r.note ? { note: r.note } : {}), evidence: ev });
  }
  // 開発者とパブリッシャーが同じなら、ストアの情報を根拠に self-published とする
  if (
    publisherIds.length > 0 &&
    publisherIds.every((p) => developerIds.includes(p)) &&
    !reasons.some((r) => r.code === 'self-published')
  ) {
    const ev = identityEvidence.find((e) => e.field === 'publishers' || e.field === 'developers')?.evidence;
    if (ev) reasons.push({ code: 'self-published', evidence: [ev] });
  }
  const game: Game = {
    schemaVersion: 1,
    id,
    status: 'candidate',
    ...draftGame,
    developerIds,
    publisherIds,
    indie: { assessment: 'unknown', reasons, assessedAt: ws.at },
    identityEvidence,
    ...(match.kind === 'none' && match.sameNameGameIds.length
      ? { disambiguation: `同名の作品: ${match.sameNameGameIds.join(', ')}` }
      : {}),
    createdAt: ws.at,
    updatedAt: ws.at,
    createdByRun: ws.runId,
  };
  game.indie.assessment = assessIndie(game, ws.repo.developers);
  ws.repo.games.push(game);
  ws.dirty.games.add(id);
  ws.createdGames.push(id);
  if (game.externalIds.steamAppId) ws.steamToRefresh.add(id);
  for (const other of match.kind === 'none' ? match.sameNameGameIds : []) {
    const g = gameById(ws, other)!;
    if (!g.disambiguation) {
      g.disambiguation = `同名の作品: ${id}`;
      g.updatedAt = ws.at;
      ws.dirty.games.add(g.id);
    }
  }
  c.temp.set(op.tempId, id);
  c.createdHere.add(id);
}

function matchExisting(ws: Workspace, input: IdentityInput) {
  return matchGame(input, ws.repo.games, ws.repo.developers, (id) => ws.repo.claims.get(id)?.claims);
}

function applyUpdateIdentity(c: ResultContext, op: Extract<Operation, { op: 'update-identity' }>): void {
  const ws = c.ws;
  const id = resolveRef(c, op.game);
  const g = assertWritable(c, id);
  const ctx = evidenceContext(ws, officialUrlsOf(ws, g));
  const evidence = evidenceFor(c, op.evidence, subjectOf(ws, g), ctx, op.op);
  const ch = op.changes;
  const add = (field: Game['identityEvidence'][number]['field']) => {
    for (const e of evidence) g.identityEvidence.push({ field, evidence: e });
  };
  if (ch.setTitle) {
    if (!evidence.some((e) => e.kind === 'official' || e.kind === 'store'))
      reject('V-I04', 'setTitle needs official or store evidence');
    const former = [g.title.display, g.title.original].filter(
      (t) => t !== ch.setTitle!.display && t !== ch.setTitle!.original,
    );
    g.aliases = [...g.aliases, ...former.map((value) => ({ value, kind: 'former' as const }))].slice(0, 30);
    g.title = ch.setTitle;
    add('title');
  }
  if (ch.addAliases) {
    const known = new Set([g.title.display, g.title.original, ...g.aliases.map((a) => a.value)].map(normalizeTitle));
    const fresh = ch.addAliases.filter((a) => !known.has(normalizeTitle(a.value)));
    g.aliases = [...g.aliases, ...fresh].slice(0, 30);
    if (fresh.length) add('aliases');
  }
  if (ch.setExternalIds) {
    for (const [k, v] of Object.entries(ch.setExternalIds) as [keyof Game['externalIds'], never][]) {
      if (v === undefined) continue;
      const cur = g.externalIds[k];
      if (cur !== undefined && cur !== v) {
        addTask(
          ws,
          makeTask(
            'fix-conflict',
            { gameId: g.id, hints: [`externalIds.${k}: ${String(cur)} / ${String(v)}`] },
            `${g.title.display} の ${k} の矛盾を確かめる`,
            'validator',
            ws.at,
          ),
        );
        reject('V-I04', `${k} already set to a different value`);
      }
      // 他の作品の強いキーと重ならないこと（D-05）
      if (ws.repo.games.some((x) => x.id !== g.id && x.status !== 'merged' && x.externalIds[k] === v))
        reject('V-I02', `${k}=${String(v)} belongs to another game`);
      (g.externalIds as Record<string, unknown>)[k] = v;
    }
    add('externalIds');
    if (ch.setExternalIds.steamAppId) ws.steamToRefresh.add(g.id);
  }
  if (ch.addAssociatedApps) {
    const known = new Set(g.associatedApps.map((a) => `${a.store}:${a.id}`));
    g.associatedApps = [
      ...g.associatedApps,
      ...ch.addAssociatedApps.filter((a) => !known.has(`${a.store}:${a.id}`)),
    ].slice(0, 30);
    add('associatedApps');
  }
  if (ch.setOfficialUrl) {
    if (g.officialUrl && normalizeUrl(g.officialUrl) !== normalizeUrl(ch.setOfficialUrl)) {
      addTask(
        ws,
        makeTask(
          'fix-conflict',
          { gameId: g.id, hints: [`officialUrl: ${g.officialUrl} / ${ch.setOfficialUrl}`.slice(0, 200)] },
          `${g.title.display} の公式サイトの矛盾を確かめる`,
          'validator',
          ws.at,
        ),
      );
      reject('V-I04', 'officialUrl already set');
    }
    if (canBeOfficialSite(ch.setOfficialUrl)) {
      g.officialUrl = ch.setOfficialUrl;
      add('officialUrl');
    }
  }
  if (ch.addDevelopers) {
    g.developerIds = [
      ...new Set([...g.developerIds, ...ch.addDevelopers.map((d) => resolveDeveloper(c, d, 'developer'))]),
    ].slice(0, 10);
    add('developers');
  }
  if (ch.addPublishers) {
    g.publisherIds = [
      ...new Set([...g.publisherIds, ...ch.addPublishers.map((d) => resolveDeveloper(c, d, 'publisher'))]),
    ].slice(0, 10);
    add('publishers');
  }
  if (ch.addIndieReasons) {
    const rctx = evidenceContext(ws, officialUrlsOf(ws, g));
    for (const r of ch.addIndieReasons) {
      const ev = r.evidence.filter((d) => !checkEvidence(d, undefined, rctx)).map((d) => toEvidence(d, rctx));
      if (ev.length && !reasonEvidenceOk(r.code, ev)) {
        count(ws, c.taskId, op.op, 'V-E05', `${r.code} needs official or store evidence（インディーの理由を除いた）`);
        continue;
      }
      if (ev.length && !g.indie.reasons.some((x) => x.code === r.code))
        g.indie.reasons.push({ code: r.code, ...(r.note ? { note: r.note } : {}), evidence: ev });
    }
    g.indie.reasons = g.indie.reasons.slice(0, 10);
  }
  g.identityEvidence = g.identityEvidence.slice(-50);
  g.indie.assessment = assessIndie(g, ws.repo.developers);
  g.indie.assessedAt = ws.at;
  g.updatedAt = ws.at;
  ws.dirty.games.add(g.id);
}

// ------------------------------------------------------------------ 記事

const STORE_NEWS_HOSTS = new Set(['store.steampowered.com', 'steamcommunity.com']);
// セールの告知は記事にしない（ia-refresh のスキル、12 §12.6.7）。「90%オフ」「過去最安」「セール開催」など
const SALE_TITLE =
  /\d+\s*[%％]\s*(?:オフ|off)|過去最安|セール[」』]?(?:を)?(?:開催|開幕|実施|中)|\bsale\b|\bdiscounts?\b/i;
const ROLE_RANK = { primary: 0, roundup: 1, mention: 2 } as const;

function applyUpsertArticle(c: ResultContext, op: Extract<Operation, { op: 'upsert-article' }>): void {
  const ws = c.ws;
  const d = op.article;
  const entry = ws.log.get(d.url);
  if (!entry || entry.status < 200 || entry.status >= 300) reject('V-E01', `article ${d.url} was not fetched`);
  if (entry!.noai || entry!.blocked) reject('V-E04', `article ${d.url} is not usable`);
  const finalUrl = entry!.finalUrl;
  // canonical は同じ登録可能ドメインのものだけを使う（04 §4.2.2）
  const canonical =
    entry!.canonicalUrl && registrableDomain(entry!.canonicalUrl) === registrableDomain(finalUrl)
      ? entry!.canonicalUrl
      : finalUrl;
  if (STORE_NEWS_HOSTS.has(new URL(canonical).hostname)) reject('V-C06', 'store announcements are not articles');
  if (SALE_TITLE.test(d.title) || SALE_TITLE.test(entry!.title ?? ''))
    reject('V-C06', 'sale announcements are not articles');
  const src = ws.repo.sources.sources.find((s) => registrableDomain(s.homepage) === registrableDomain(canonical));
  if (src && !src.rights.allowFetch) reject('V-E04', `${src.id} forbids fetching`);
  if (d.games.length > 30) reject('V-C06', 'too many games');
  if (d.games.some((g) => g.role === 'roundup') && d.kind !== 'roundup' && d.kind !== 'feature')
    reject('V-C06', 'roundup role needs a roundup or feature article');
  // 記事の短い説明は任意の項目なので、規則に合わなければ説明だけを外して記事は残す
  let summaryJa = d.summaryJa;
  if (summaryJa && textIssues(summaryJa).length) {
    count(
      ws,
      c.taskId,
      op.op,
      'V-C01',
      `summaryJa: ${textIssues(summaryJa)
        .map((i) => i.match)
        .join(', ')}（説明を外した）`,
    );
    summaryJa = undefined;
  }
  // 日本語以外の記事のタイトルの訳も任意の項目。規則に合わなければ訳だけを外す（06 §6.13.9）
  let titleJa = d.lang !== 'ja' && d.titleJa ? d.titleJa.trim() : undefined;
  if (titleJa && titleIssues(titleJa, d.title).length) {
    count(ws, c.taskId, op.op, 'V-C01', `titleJa: ${titleIssues(titleJa, d.title).join('、')}（訳を外した）`);
    titleJa = undefined;
  }

  // 記事が扱う作品だけを関連づける（本文やタイトルに名前がない作品は外す）
  const links: Article['games'] = [];
  for (const link of d.games) {
    let gid: string;
    try {
      gid = resolveRef(c, link.ref);
    } catch (e) {
      if (e instanceof Rejected) {
        count(ws, c.taskId, op.op, e.rule, `${e.message}（記事の関連を1件除いた）`);
        continue;
      }
      throw e;
    }
    const g = gameById(ws, gid)!;
    if (g.status === 'merged') continue;
    if (
      !subjectOf(ws, g).names.some(
        (n) =>
          normalizeTitle(n).length >= 2 &&
          normalizeTitle(`${entry!.title ?? ''} ${entry!.text}`).includes(normalizeTitle(n)),
      )
    ) {
      count(ws, c.taskId, op.op, 'V-E03', `${d.url} does not mention ${g.title.display}（記事の関連を1件除いた）`);
      continue;
    }
    if (!links.some((l) => l.gameId === gid))
      links.push({ gameId: gid, role: link.role, ...(link.note ? { note: link.note } : {}) });
  }
  if (links.length === 0) reject('V-C06', 'the article links no game');

  const id = articleId(canonical);
  const existing = ws.repo.articles.find((a) => a.id === id);
  if (!existing && ws.newArticles.length >= ws.repo.runtime.limits.maxNewArticles) {
    addTask(
      ws,
      makeTask('process-article', { url: canonical }, `記事「${d.title.slice(0, 100)}」を処理する`, 'validator', ws.at),
    );
    reject('V-L02', 'too many new articles in this run');
  }
  // 正規化の前の URL（追跡用のパラメーター付きなど）も別名に残す（04 §4.2.2）
  const aliases = [...new Set([d.url, finalUrl].filter((u) => u !== canonical))];
  if (existing) {
    for (const l of links) {
      const cur = existing.games.find((x) => x.gameId === l.gameId);
      if (!cur) existing.games.push(l);
      else if (ROLE_RANK[l.role] < ROLE_RANK[cur.role]) cur.role = l.role;
    }
    existing.urlAliases = [...new Set([...existing.urlAliases, ...aliases])].slice(0, 10);
    if (titleJa && !existing.titleJa && existing.lang !== 'ja') existing.titleJa = titleJa;
    existing.updatedAt = ws.at;
  } else {
    const article: Article = {
      schemaVersion: 1,
      id,
      url: d.url,
      canonicalUrl: canonical,
      urlAliases: aliases.slice(0, 10),
      ...(src ? { sourceId: src.id } : {}),
      outlet: { name: src?.name ?? d.outletName, domain: new URL(canonical).hostname.replace(/^www\./, '') },
      title: d.title,
      ...(titleJa && (src?.lang ?? d.lang) !== 'ja' ? { titleJa } : {}),
      lang: src?.lang ?? d.lang,
      kind: d.kind,
      ...((d.publishedAt ?? entry!.publishedAt) ? { publishedAt: d.publishedAt ?? entry!.publishedAt } : {}),
      retrievedAt: entry!.retrievedAt,
      ...(summaryJa && src?.rights.displaySummary ? { summaryJa } : {}),
      ...(d.derivedFrom
        ? {
            derivedFrom: {
              kind: 'press-release' as const,
              key: d.derivedFrom.key,
              ...(d.derivedFrom.url ? { url: d.derivedFrom.url } : {}),
            },
          }
        : {}),
      games: links,
      status: 'active',
      ...(entry!.fetchHash ? { contentHash: entry!.fetchHash } : {}),
      createdAt: ws.at,
      updatedAt: ws.at,
      createdByRun: ws.runId,
    };
    ws.repo.articles.push(article);
    ws.newArticles.push(id);
  }
  ws.counts.articlesLinked += links.length;
  ws.dirty.articles.add(id);
  markSeen(ws, [d.url, canonical, finalUrl], {
    status: 'article',
    articleId: id,
    ...(src ? { sourceId: src.id } : {}),
  });
}

export function markSeen(
  ws: Workspace,
  urls: string[],
  e: { status: 'article' | 'task' | 'irrelevant' | 'failed'; articleId?: string; taskId?: string; sourceId?: string },
): void {
  for (const u of new Set(urls.map((x) => urlKey(x)))) {
    const prev = ws.repo.seenUrls.entries[u];
    // 記事として登録した URL を、後から別の扱いで上書きしない
    if (prev?.status === 'article' && e.status !== 'article') continue;
    ws.repo.seenUrls.entries[u] = {
      ...e,
      attempts: e.status === 'failed' ? (prev?.attempts ?? 0) + 1 : (prev?.attempts ?? 0),
      firstSeenAt: prev?.firstSeenAt ?? ws.today,
      lastSeenAt: ws.today,
    };
    if (e.status === 'failed' && ws.repo.seenUrls.entries[u]!.attempts >= 3)
      ws.repo.seenUrls.entries[u]!.status = 'irrelevant';
  }
  ws.dirty.seenUrls = true;
}

// ------------------------------------------------------------------ Claim

const TEXT_FIELDS = new Set(['summary', 'features', 'overview']);
const UNSCOPED_FIELDS = new Set(['summary', 'features', 'overview', 'tag']);

function claimsFileOf(ws: Workspace, gameId: string): ClaimsFile {
  let f = ws.repo.claims.get(gameId);
  if (!f) {
    f = { schemaVersion: 1, gameId, claims: [] };
    ws.repo.claims.set(gameId, f);
  }
  return f;
}

function findClaim(ws: Workspace, id: string): Claim | undefined {
  for (const f of ws.repo.claims.values()) {
    const c = f.claims.find((x) => x.id === id);
    if (c) return c;
  }
  return undefined;
}

function textsOf(d: ClaimDraft): string[] {
  if (d.field === 'summary') return [d.value.ja];
  if (d.field === 'features' || d.field === 'overview') return d.value.ja;
  return [];
}

/** get_steam_app の取得ログの値と Claim の値が一致するか（V-E02 の locator） */
function locatorValueOk(ws: Workspace, d: ClaimDraft, game: Game): boolean {
  const steamEv = d.evidence.filter((e) => e.locator?.startsWith('steam:') && !e.quote);
  if (steamEv.length === 0) return true;
  const s = game.externalIds.steamAppId ? steamLog(ws, game.externalIds.steamAppId) : undefined;
  if (!s) return false;
  if (d.field === 'release') {
    const platforms = (s.platforms as string[] | undefined) ?? [];
    return (
      canonicalJson(s.release) === canonicalJson(d.value) && (!d.scope.platform || platforms.includes(d.scope.platform))
    );
  }
  if (d.field === 'japaneseSupport')
    return !!s.japaneseSupport && canonicalJson(s.japaneseSupport) === canonicalJson(d.value);
  if (d.field === 'storeLink')
    return d.value.store === 'steam' && normalizeUrl(d.value.url) === normalizeUrl(storeUrl(Number(s.appId)));
  if (d.field === 'image') return d.value.url === s.headerImage;
  if (d.field === 'playerModes')
    return (
      JSON.stringify([...((s.playerModes as string[]) ?? [])].sort()) === JSON.stringify([...d.value.modes].sort())
    );
  return true;
}

function applyAddClaim(c: ResultContext, op: Extract<Operation, { op: 'add-claim' }>): void {
  const ws = c.ws;
  const gid = resolveRef(c, op.game);
  const g = assertWritable(c, gid);
  // 紹介文、特徴、タグは機種ごとに分けない（LLM が範囲を付けても外す）
  const d: ClaimDraft = UNSCOPED_FIELDS.has(op.claim.field) ? { ...op.claim, scope: {} } : op.claim;
  if (d.asOf > ws.today) reject('V-E06', `asOf ${d.asOf} is in the future`);
  for (const t of textsOf(d)) assertText(t);
  if (d.field === 'release' && (d.value.status === 'released' || d.value.status === 'early-access') && !d.value.date) {
    reject('V-C02', `${d.value.status} needs a date`);
  }
  if (d.field === 'tag') {
    const tag = ws.repo.tags.tags.find((t) => t.id === d.value.tagId);
    if (!tag || tag.status === 'deprecated') reject('V-C03', `tag ${d.value.tagId} does not exist`);
  }
  if (!locatorValueOk(ws, d, g)) reject('V-E02', `${d.field} does not match the Steam data`);
  const ctx = evidenceContext(ws, officialUrlsOf(ws, g));
  const evidence = evidenceFor(c, d.evidence, subjectOf(ws, g), ctx, op.op);
  if (!basisOk(d.basis, evidence)) reject('V-E05', `basis ${d.basis} does not match the evidence kinds`);
  if (d.field === 'image') {
    const allowed = evidence.some((e) => {
      const src = ws.repo.sources.sources.find((s) => s.id === e.sourceId);
      return src ? src.rights.displayImages : e.kind === 'official' || e.kind === 'store';
    });
    if (!allowed) reject('V-C05', 'image is not permitted by the source');
  }
  const file = claimsFileOf(ws, gid);
  // 同じ値の有効な Claim があれば、新しい Claim を作らずに根拠を加える（発売情報の rawText の違いなど）
  const same = file.claims.find(
    (x) =>
      x.field === d.field &&
      canonicalJson(x.scope) === canonicalJson(d.scope) &&
      (x.status === 'adopted' || x.status === 'candidate' || x.status === 'conflicted') &&
      valueKey(x) === valueKey({ field: d.field, value: d.value } as Claim),
  );
  if (same && !TEXT_FIELDS.has(d.field)) {
    for (const e of evidence) {
      const i = same.evidence.findIndex((x) => x.originKey === e.originKey);
      if (i >= 0) same.evidence[i] = e;
      else if (same.evidence.length < 20) same.evidence.push(e);
    }
    same.lastCheckedAt = evidence.reduce((m, e) => (e.retrievedAt > m ? e.retrievedAt : m), same.lastCheckedAt);
    ws.dirty.claims.add(gid);
    return;
  }
  let status: Claim['status'] = 'candidate';
  let replaced: Claim | undefined;
  if (TEXT_FIELDS.has(d.field)) {
    const current = file.claims.find((x) => x.field === d.field && x.status === 'adopted');
    if (!current) status = 'adopted';
    else {
      // V-C04: 言い換えだけの置き換えをしない
      const r = op.replace;
      const newFacts =
        r?.reason === 'new-facts' &&
        r.basedOnClaimIds.some((id) => {
          const b = file.claims.find((x) => x.id === id);
          return b?.status === 'adopted' && !!b.adoptedAt && !!current.adoptedAt && b.adoptedAt > current.adoptedAt;
        });
      const invalid =
        r?.reason === 'current-invalid' &&
        ws.repo.tasks.tasks.some(
          (t) =>
            (t.type === 'fix-reported-error' || t.type === 'fix-conflict') &&
            t.status !== 'done' &&
            t.status !== 'dropped' &&
            t.target.gameId === gid,
        );
      if (!newFacts && !invalid) reject('V-C04', 'paraphrase-only');
      status = 'adopted';
      replaced = current;
    }
  }
  const claim = makeClaim({
    gameId: gid,
    field: d.field,
    scope: d.scope,
    value: d.value as never,
    basis: d.basis,
    evidence,
    asOf: d.asOf,
    status,
    at: ws.at,
    createdBy: 'llm',
    createdByRun: ws.runId,
  });
  const supersedes = (d.supersedes ?? []).filter((id) => {
    const s = file.claims.find((x) => x.id === id);
    return s && s.field === d.field && JSON.stringify(s.scope) === JSON.stringify(d.scope);
  });
  if (supersedes.length) claim.supersedes = supersedes;
  if (replaced) {
    replaced.status = 'superseded';
    replaced.statusReason = 'newer-source';
    replaced.supersededBy = claim.id;
    replaced.updatedAt = ws.at;
    claim.supersedes = [...new Set([...(claim.supersedes ?? []), replaced.id])];
  }
  const added = upsertClaim(file, claim);
  if (added) {
    ws.counts.claimsAdded++;
    if (!ws.newClaimIds.has(gid)) ws.newClaimIds.set(gid, new Set());
    ws.newClaimIds.get(gid)!.add(claim.id);
  }
  ws.dirty.claims.add(gid);
}

function claimContext(c: ResultContext, claimIdValue: string): { claim: Claim; game: Game } {
  const claim = findClaim(c.ws, claimIdValue);
  if (!claim) reject('V-S02', `claim ${claimIdValue} does not exist`);
  const game = assertWritable(c, claim!.gameId);
  return { claim: claim!, game };
}

function applyConfirmClaim(c: ResultContext, op: Extract<Operation, { op: 'confirm-claim' }>): void {
  const { claim, game } = claimContext(c, op.claimId);
  const evidence = evidenceFor(
    c,
    op.evidence,
    subjectOf(c.ws, game),
    evidenceContext(c.ws, officialUrlsOf(c.ws, game)),
    op.op,
  );
  for (const e of evidence) {
    const i = claim.evidence.findIndex((x) => x.originKey === e.originKey);
    if (i >= 0) {
      if (e.retrievedAt >= claim.evidence[i]!.retrievedAt) claim.evidence[i] = e;
    } else if (claim.evidence.length < 20) claim.evidence.push(e);
  }
  const latest = evidence.reduce((m, e) => (e.retrievedAt > m ? e.retrievedAt : m), claim.lastCheckedAt);
  claim.lastCheckedAt = latest;
  c.ws.dirty.claims.add(game.id);
}

function applyRetractClaim(c: ResultContext, op: Extract<Operation, { op: 'retract-claim' }>): void {
  const ws = c.ws;
  const { claim, game } = claimContext(c, op.claimId);
  assertText(op.reason);
  const evidence = evidenceFor(
    c,
    op.evidence,
    subjectOf(ws, game),
    evidenceContext(ws, officialUrlsOf(ws, game)),
    op.op,
  );
  if (tier({ evidence }) < tier(claim)) {
    addTask(
      ws,
      makeTask(
        'fix-conflict',
        { gameId: game.id, field: claim.field, claimIds: [claim.id] },
        `${game.title.display} の ${claim.field} を撤回する根拠を確かめる`,
        'validator',
        ws.at,
      ),
    );
    reject('V-E05', 'retraction evidence ranks lower than the claim');
  }
  claim.status = 'retracted';
  claim.statusReason = 'retracted-by-evidence';
  claim.updatedAt = ws.at;
  delete claim.supersededBy;
  ws.dirty.claims.add(game.id);
  if (!ws.newClaimIds.has(game.id)) ws.newClaimIds.set(game.id, new Set());
}

// ------------------------------------------------------------------ 関係とコレクション

function applyAddRelation(c: ResultContext, op: Extract<Operation, { op: 'add-relation' }>): void {
  const ws = c.ws;
  const a = resolveRef(c, op.a);
  const b = resolveRef(c, op.b);
  if (a === b) reject('V-C08', 'a and b are the same');
  for (const id of [a, b]) {
    const g = gameById(ws, id)!;
    if (g.status !== 'published' && g.status !== 'candidate') reject('V-C08', `${id} is ${g.status}`);
  }
  assertText(op.reason);
  const adopted = new Set(
    [a, b].flatMap((id) =>
      (ws.repo.claims.get(id)?.claims ?? []).filter((x) => x.status === 'adopted').map((x) => x.id),
    ),
  );
  if (op.evidenceClaimIds.some((id) => !adopted.has(id)))
    reject('V-C08', 'evidenceClaimIds must be adopted claims of a or b');
  if (op.kind === 'similar-play') {
    const tags = (id: string) =>
      new Set(adoptedOf(ws.repo.claims.get(id)?.claims ?? [], 'tag').map((t) => t.value.tagId));
    const ta = tags(a);
    const shared = [...tags(b)].filter((t) => ta.has(t)).length;
    const both = ws.repo.articles.some(
      (art) => art.games.some((g) => g.gameId === a) && art.games.some((g) => g.gameId === b),
    );
    if (shared < 2 && !both) reject('V-C08', 'similar-play needs two shared tags or an article about both');
  }
  const [x, y] = a < b ? [a, b] : [b, a];
  const id = relationId(x, y, op.kind);
  if (ws.repo.relations.relations.some((r) => r.id === id)) return;
  const ga = gameById(ws, x)!;
  const evidence = op.evidence.length
    ? evidenceFor(c, op.evidence, undefined, evidenceContext(ws, officialUrlsOf(ws, ga)), op.op)
    : [];
  ws.repo.relations.relations.push({
    id,
    a: x,
    b: y,
    kind: op.kind,
    reason: op.reason,
    basis: 'editorial',
    evidenceClaimIds: op.evidenceClaimIds,
    evidence: evidence.slice(0, 5),
    status: 'adopted',
    createdBy: 'llm',
    createdAt: ws.at,
    updatedAt: ws.at,
    createdByRun: ws.runId,
  });
  ws.dirty.relations = true;
  ws.counts.relationsAdded++;
}

function applyCollectionAdd(c: ResultContext, op: Extract<Operation, { op: 'collection-add' }>): void {
  const ws = c.ws;
  const col = ws.repo.collections.find((x) => x.id === op.collectionId);
  if (!col) reject('V-S02', `collection ${op.collectionId} does not exist`);
  const gid = resolveRef(c, op.game);
  const g = gameById(ws, gid)!;
  if (g.status !== 'published') reject('V-C07', `${gid} is not published`);
  if (col!.items.some((i) => i.gameId === gid)) return;
  if (col!.items.length >= 60) reject('V-C07', 'collection is full');
  assertText(op.reason);
  const claims = ws.repo.claims.get(gid)?.claims ?? [];
  if (!matchesRules(claimsView(claims), col!.criteria.rules)) reject('V-C07', `${gid} does not satisfy the rules`);
  const adopted = new Set(claims.filter((x) => x.status === 'adopted').map((x) => x.id));
  if (op.evidenceClaimIds.some((id) => !adopted.has(id)))
    reject('V-C07', 'evidenceClaimIds must be adopted claims of the game');
  col!.items.push({
    gameId: gid,
    reason: op.reason,
    evidenceClaimIds: op.evidenceClaimIds,
    addedAt: ws.today,
    addedBy: 'llm',
    position: Math.max(-1, ...col!.items.map((i) => i.position)) + 1,
  });
  col!.updatedAt = ws.at;
  ws.dirty.collections.add(col!.id);
  ws.counts.collectionsChanged++;
}

function applyCollectionRemove(c: ResultContext, op: Extract<Operation, { op: 'collection-remove' }>): void {
  const ws = c.ws;
  const col = ws.repo.collections.find((x) => x.id === op.collectionId);
  if (!col) reject('V-S02', `collection ${op.collectionId} does not exist`);
  assertText(op.reason);
  if (!col!.items.some((i) => i.gameId === op.gameId)) return;
  if (col!.status === 'published' && col!.items.length <= 4)
    reject('V-C07', 'a published collection needs at least 4 games');
  col!.items = col!.items.filter((i) => i.gameId !== op.gameId);
  col!.updatedAt = ws.at;
  ws.dirty.collections.add(col!.id);
  ws.counts.collectionsChanged++;
}

// ------------------------------------------------------------------ タグとレビュー待ち

function applyProposeTag(c: ResultContext, op: Extract<Operation, { op: 'propose-tag' }>): void {
  const ws = c.ws;
  const names = [op.tag.label.ja, op.tag.label.en, ...op.tag.aliases].map(normalizeTitle);
  const clash = ws.repo.tags.tags.find(
    (t) =>
      t.id === op.tag.id || [t.label.ja, t.label.en, ...t.aliases].map(normalizeTitle).some((n) => names.includes(n)),
  );
  if (clash) return; // V-C03: 既存のタグに置き換える（新しく作らない）
  assertText(op.tag.definition);
  ws.repo.tags.tags.push({ ...op.tag, status: 'candidate', createdBy: 'llm', createdAt: ws.at });
  ws.dirty.tags = true;
}

function queueReview(
  c: ResultContext,
  kind: 'merge-games' | 'developer-independence' | 'core-tag-change' | 'collection-publish',
  op: Operation,
  reason: string,
): void {
  const ws = c.ws;
  const id = reviewId(kind, op);
  if (ws.repo.reviewQueue.items.some((i) => i.id === id)) return;
  ws.repo.reviewQueue.items.push({
    id,
    kind,
    operation: op as unknown as Record<string, unknown>,
    reason: reason.slice(0, 500),
    createdAt: ws.at,
    createdByRun: ws.runId,
    status: 'open',
  });
  ws.dirty.reviewQueue = true;
}

// ------------------------------------------------------------------ 催し（06 §6.13.1）

function recheckAfterFor(start: string, status: string, today: string): string {
  if (status === 'tentative') return addDays(today, 7);
  const weekBefore = addDays(start, -7);
  if (today < weekBefore) return weekBefore;
  if (today < start) return start;
  return addDays(today, 30);
}

function applyUpsertEvent(c: ResultContext, op: Extract<Operation, { op: 'upsert-event' }>): void {
  const ws = c.ws;
  const d = op.event;
  assertText(d.summary);
  const pageEntry = ws.log.get(d.url);
  if (!pageEntry || pageEntry.status < 200 || pageEntry.status >= 300)
    reject('V-EV02', `event page ${d.url} was not fetched`);
  const subject: Subject = { names: [d.name, ...(d.nameEn ? [d.nameEn] : [])], steamAppIds: [], urls: [d.url] };
  const ctx = evidenceContext(ws, [d.url]);
  const evidence = evidenceFor(c, d.evidence, subject, ctx, op.op);
  // V-EV01: 抜粋の日付が開始日と終了日に一致する
  const quotes = d.evidence.filter((e) => e.quote).map((e) => e.quote!);
  if (d.status !== 'cancelled' && !eventDatesSupported(d.start, d.end, quotes))
    reject('V-EV01', 'the quoted dates do not match start and end');
  if (d.end && startOf(d.end) < startOf(d.start)) reject('V-EV01', 'end is before start');
  // V-EV05: 会場の催しとオンラインの催しを分ける（04 の D-15）。セールはオンライン、オンラインの催しに会場はない
  if (d.kind === 'sale' && d.format !== 'online') reject('V-EV05', 'a sale must be online');
  if (d.format === 'online' && d.location) reject('V-EV05', 'an online event must not have a location');
  // V-EV04: 出展作品は既存の作品だけ
  const games: string[] = [];
  for (const ref of d.games) {
    if ('gameId' in ref && gameById(ws, ref.gameId) && gameById(ws, ref.gameId)!.status !== 'merged')
      games.push(ref.gameId);
    else if ('tempId' in ref) {
      const id = c.temp.get(ref.tempId);
      if (id) games.push(id);
    }
  }
  const start = startOf(d.start);
  const id = eventId(d.url, start);
  // V-EV03: 同じ ID か、正規化した名前と開始日が同じ催しがあれば更新する
  const sameName = (e: IndieEvent) => normalizeTitle(e.name) === normalizeTitle(d.name) && startOf(e.start) === start;
  let existing = ws.repo.events.find((e) => e.id === id) ?? ws.repo.events.find(sameName);
  const replaced = op.replacesEventId ? ws.repo.events.find((e) => e.id === op.replacesEventId) : undefined;
  if (!existing && replaced && replaced.id !== id) {
    // 開始日が変わった: 新しい ID で作り、前のファイルを消す
    ws.repo.events = ws.repo.events.filter((e) => e.id !== replaced.id);
    ws.dirty.eventsDeleted.add(replaced.id);
    existing = undefined;
  }
  const base = existing ?? replaced;
  const aliases = [...new Set([...(base?.aliases ?? []), ...(d.aliases ?? [])])].slice(0, 8);
  const event: IndieEvent = {
    schemaVersion: 1,
    id: existing?.id ?? id,
    status: d.status,
    name: d.name,
    ...(d.nameEn ? { nameEn: d.nameEn } : {}),
    ...(aliases.length ? { aliases } : {}),
    kind: d.kind,
    format: d.format,
    start: d.start,
    ...(d.end ? { end: d.end } : {}),
    ...(d.time ? { time: d.time } : {}),
    ...(d.location ? { location: d.location } : {}),
    url: existing?.url ?? d.url,
    summary: base?.createdBy === 'human' ? base.summary : d.summary,
    ...(base?.image && existing ? { image: base.image } : {}),
    games: [...new Set([...(existing?.games ?? []), ...games])].slice(0, 60),
    evidence: [
      ...evidence,
      ...(existing?.evidence ?? []).filter((e) => !evidence.some((x) => x.originKey === e.originKey)),
    ].slice(0, 10),
    recheckAfter: recheckAfterFor(start, d.status, ws.today),
    createdAt: base?.createdAt ?? ws.at,
    updatedAt: ws.at,
    createdBy: base?.createdBy ?? 'llm',
    createdByRun: base?.createdByRun ?? ws.runId,
  };
  if (event.id !== eventId(event.url, start)) {
    // 案内のページが変わらないまま開始日が変わった
    ws.repo.events = ws.repo.events.filter((e) => e.id !== event.id);
    ws.dirty.eventsDeleted.add(event.id);
    event.id = eventId(event.url, start);
    delete event.image;
  }
  ws.repo.events = [...ws.repo.events.filter((e) => e.id !== event.id), event];
  ws.dirty.events.add(event.id);
  ws.dirty.eventsDeleted.delete(event.id);
  if (!existing) ws.newEvents.push(event.id);
}

// ------------------------------------------------------------------ 結果ごとの処理

export function applyTaskResult(ws: Workspace, task: Task, result: TaskResult): void {
  const limits = ws.repo.runtime.limits;
  const c: ResultContext = { ws, task, taskId: task.id, temp: new Map(), createdHere: new Set() };
  // V-L03: 操作と後続のタスクの数
  if (
    result.operations.length > limits.maxOperationsPerTask ||
    result.followUpTasks.length > limits.maxFollowUpTasksPerTask
  ) {
    count(ws, task.id, 'result', 'V-L03', 'too many operations or follow-up tasks');
    return;
  }
  if (result.injectionDetected) ws.pending.push(`${task.id}: 取得したページに指示文があった`.slice(0, 200));
  const ops = [...result.operations].sort((a, b) => ORDER.indexOf(a.op) - ORDER.indexOf(b.op));
  for (const op of ops) {
    try {
      if (!ALLOWED_OPERATIONS[task.type].includes(op.op)) reject('V-S04', `${op.op} is not allowed for ${task.type}`);
      switch (op.op) {
        case 'upsert-developer':
          applyUpsertDeveloper(c, op);
          break;
        case 'create-game':
          applyCreateGame(c, op);
          break;
        case 'update-identity':
          applyUpdateIdentity(c, op);
          break;
        case 'upsert-article':
          applyUpsertArticle(c, op);
          break;
        case 'add-claim':
          applyAddClaim(c, op);
          break;
        case 'confirm-claim':
          applyConfirmClaim(c, op);
          break;
        case 'retract-claim':
          applyRetractClaim(c, op);
          break;
        case 'add-relation':
          applyAddRelation(c, op);
          break;
        case 'collection-add':
          applyCollectionAdd(c, op);
          break;
        case 'collection-remove':
          applyCollectionRemove(c, op);
          break;
        case 'propose-tag':
          applyProposeTag(c, op);
          break;
        case 'upsert-event':
          applyUpsertEvent(c, op);
          break;
        case 'propose-merge':
          queueReview(c, 'merge-games', op, op.reason);
          break;
        case 'propose-tag-change':
          queueReview(c, 'core-tag-change', op, op.detail);
          break;
        case 'create-collection-draft':
          for (const i of op.items) assertText(i.reason);
          assertText(op.draft.lede);
          queueReview(c, 'collection-publish', op, `新しいコレクション「${op.draft.title}」`);
          break;
      }
    } catch (e) {
      if (!(e instanceof Rejected)) throw e;
      if (op.op === 'create-game' && !c.temp.has(op.tempId)) c.temp.set(op.tempId, null);
      count(ws, task.id, op.op, e.rule, e.message);
    }
  }
}

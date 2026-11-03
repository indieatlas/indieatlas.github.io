import type { Claim, ClaimsFile, Evidence } from '../../schema/claim.ts';
import type { Actor, Platform } from '../../schema/common.ts';
import type { Developer } from '../../schema/developer.ts';
import type { Game } from '../../schema/game.ts';
import type { HttpClient } from '../fetch/http.ts';
import { makeClaim, supersede, upsertClaim } from '../lib/claim-builder.ts';
import { SINGLE_VALUE_FIELDS, scopeKey } from '../../schema/claim.ts';
import { toIsoDateTime, toJstDate } from '../lib/clock.ts';
import { canBeOfficialSite } from '../lib/domains.ts';
import { UserError } from '../lib/errors.ts';
import { nextNumericId } from '../lib/ids.ts';
import type { RepoData } from '../lib/repo-io.ts';
import { normalizeTitle } from '../lib/text-normalize.ts';
import {
  fetchAppDetails,
  fetchStorePage,
  isAdultSexualContent,
  japaneseSupportFrom,
  parseLanguageTable,
  platformsFrom,
  playerModesFrom,
  releaseFrom,
  stableImageUrl,
  storeUrl,
  type SteamAppDetails,
} from '../sources/steam.ts';
import { assessIndie } from './publish-rules.ts';

export interface SeedOptions {
  createdBy: Actor;
  runId: string;
}

export interface SeedResult {
  gameId: string;
  created: boolean;
  games: Game[]; // 書き込む作品
  developers: Developer[]; // 書き込む開発者
  claims?: ClaimsFile; // 書き込む Claim
  claimsAdded: number;
  notes: string[];
}

const CJK = /[぀-ヿ㐀-鿿]/;

function steamEvidence(appId: number, locator: string, retrievedAt: string, fetchHash?: string): Evidence {
  return {
    kind: 'store',
    url: storeUrl(appId),
    retrievedAt,
    locator,
    originKey: 'store:steam',
    ...(fetchHash ? { fetchHash } : {}),
  };
}

function findDeveloper(devs: Developer[], name: string): Developer | undefined {
  const key = normalizeTitle(name);
  return devs.find((d) => [d.name.display, d.name.original, ...d.aliases].some((n) => normalizeTitle(n) === key));
}

/**
 * Steam の作品詳細から、候補（candidate）の作品、開発者、Claim を作る（09 P1-04）。
 * LLM は使わない。既存の作品（同じ Steam の ID）なら、足りない Claim と付属アプリだけを加える。
 * 体験版や DLC の ID を渡した場合は、登録済みの本編の associatedApps に加える。
 */
export async function seedFromSteam(
  http: HttpClient,
  repo: RepoData,
  appId: number,
  opts: SeedOptions,
): Promise<SeedResult> {
  const en = await fetchAppDetails(http, appId, 'english');
  const jp = await fetchAppDetails(http, appId, 'japanese');
  const app = en.data;
  const at = toIsoDateTime(en.retrievedAt);
  const notes: string[] = [];

  if (app.type !== 'game') return attachToParent(repo, app, at);
  if (isAdultSexualContent(app)) {
    throw new UserError(`${appId} は成人向けの性的な内容に関する記述子を持つため登録しない（05 §5.5.3）`);
  }

  const active = repo.games.filter((g) => g.status !== 'merged');
  const existing = active.find((g) => g.externalIds.steamAppId === appId);
  const gameId =
    existing?.id ??
    nextNumericId(
      'game',
      repo.games.map((g) => g.id),
    );

  // 開発者とパブリッシャー
  const developers = [...repo.developers];
  const touched = new Map<string, Developer>();
  const resolveDev = (name: string, role: 'developer' | 'publisher'): string => {
    let d = findDeveloper(developers, name);
    if (!d) {
      d = {
        schemaVersion: 1,
        id: nextNumericId(
          'developer',
          developers.map((x) => x.id),
        ),
        name: { display: name, original: name },
        aliases: [],
        roles: [role],
        links: [],
        independence: { status: 'unknown', setBy: 'system', evidence: [] },
        createdAt: at,
        updatedAt: at,
        createdByRun: opts.runId,
      };
      developers.push(d);
      touched.set(d.id, d);
    } else if (!d.roles.includes(role)) {
      d = { ...d, roles: [...d.roles, role].sort() as Developer['roles'], updatedAt: at };
      developers[developers.findIndex((x) => x.id === d!.id)] = d;
      touched.set(d.id, d);
    }
    return d.id;
  };
  const developerIds = [...new Set((app.developers ?? []).map((n) => resolveDev(n, 'developer')))];
  const publisherIds = [...new Set((app.publishers ?? []).map((n) => resolveDev(n, 'publisher')))];

  // 作品
  const enName = app.name.trim();
  const jaName = jp.data.name.trim();
  const originalLang = CJK.test(enName) ? 'ja' : 'en';
  const display = jaName && jaName !== enName ? jaName : enName;
  const aliases: Game['aliases'] = display !== enName ? [{ value: display, lang: 'ja', kind: 'localized' }] : [];
  const official = app.website && canBeOfficialSite(app.website) ? app.website : undefined;
  const ev = (locator: string) => steamEvidence(appId, locator, at, en.fetchHash);
  const identityEvidence: Game['identityEvidence'] = [
    { field: 'externalIds', evidence: ev('steam:appdetails.steam_appid') },
    { field: 'title', evidence: ev('steam:appdetails.name') },
    { field: 'developers', evidence: ev('steam:appdetails.developers') },
    { field: 'publishers', evidence: ev('steam:appdetails.publishers') },
    ...(official ? [{ field: 'officialUrl' as const, evidence: ev('steam:appdetails.website') }] : []),
  ];
  const associatedApps: Game['associatedApps'] = [
    ...(app.demos ?? []).map((d) => ({ store: 'steam' as const, id: String(d.appid), kind: 'demo' as const })),
    ...(app.dlc ?? []).map((id) => ({ store: 'steam' as const, id: String(id), kind: 'dlc' as const })),
  ].slice(0, 30);
  const selfPublished =
    publisherIds.length > 0 && publisherIds.every((id) => developerIds.includes(id))
      ? [{ code: 'self-published' as const, evidence: [ev('steam:appdetails.developers,publishers')] }]
      : [];
  if (selfPublished.length === 0) notes.push('開発者とパブリッシャーが異なる。インディーの理由を人が確認する');

  let game: Game;
  if (existing) {
    const known = new Set(existing.associatedApps.map((a) => `${a.store}:${a.id}`));
    game = {
      ...existing,
      associatedApps: [
        ...existing.associatedApps,
        ...associatedApps.filter((a) => !known.has(`${a.store}:${a.id}`)),
      ].slice(0, 30),
      updatedAt: at,
    };
  } else {
    const draft: Game = {
      schemaVersion: 1,
      id: gameId,
      status: 'candidate',
      title: { display, original: enName, originalLang },
      aliases,
      externalIds: { steamAppId: appId },
      associatedApps,
      ...(official ? { officialUrl: official } : {}),
      developerIds,
      publisherIds,
      indie: { assessment: 'unknown', reasons: selfPublished, assessedAt: at },
      identityEvidence,
      createdAt: at,
      updatedAt: at,
      createdByRun: opts.runId,
    };
    draft.indie.assessment = assessIndie(draft, developers);
    game = draft;
  }

  // Claim
  const asOf = toJstDate(en.retrievedAt);
  const base = { gameId, at, createdBy: opts.createdBy, createdByRun: opts.runId, asOf };
  const claims: Claim[] = [];
  const release = releaseFrom(app);
  for (const platform of platformsFrom(app) as Platform[]) {
    claims.push(
      makeClaim({
        ...base,
        field: 'release',
        scope: { platform, region: 'global' },
        value: release,
        evidence: [ev('steam:appdetails.release_date')],
      }),
    );
  }
  const page = await fetchStorePage(http, appId);
  const languages = page.status === 200 ? parseLanguageTable(page.text) : [];
  if (languages.length > 0) {
    claims.push(
      makeClaim({
        ...base,
        field: 'japaneseSupport',
        value: japaneseSupportFrom(languages),
        evidence: [steamEvidence(appId, 'steam:store.language_table', toIsoDateTime(page.retrievedAt), page.fetchHash)],
      }),
    );
  } else {
    notes.push('ストアのページから言語の表を読めなかった');
  }
  const modes = playerModesFrom(app);
  if (modes.length > 0) {
    claims.push(
      makeClaim({ ...base, field: 'playerModes', value: { modes }, evidence: [ev('steam:appdetails.categories')] }),
    );
  }
  claims.push(
    makeClaim({
      ...base,
      field: 'storeLink',
      value: { store: 'steam', url: storeUrl(appId) },
      evidence: [ev('steam:appdetails.steam_appid')],
    }),
  );
  const served = app.header_image ? stableImageUrl(app.header_image) : undefined;
  // セールや催しの間だけ差し替わるヘッダー画像（header_alt_assets_N.jpg）は取り込まない。
  // Steam のヘッダー画像がまだない作品では、差し替えの前の画像（/apps/{appId}/header.jpg）を使う
  const temporaryHeader = !!served && /\/header_alt_assets_\d+\.\w+$/.test(served);
  const hasSteamHeader = (repo.claims.get(gameId)?.claims ?? []).some(
    (x) =>
      x.field === 'image' &&
      x.status === 'adopted' &&
      x.value.role === 'header' &&
      x.evidence.some((e) => e.locator === 'steam:appdetails.header_image'),
  );
  const header = temporaryHeader
    ? hasSteamHeader
      ? undefined
      : served!.replace(new RegExp(`(/apps/${appId}/).*$`), '$1header.jpg')
    : served;
  if (temporaryHeader) {
    notes.push(
      header
        ? 'ヘッダー画像が期間限定の差し替え（header_alt_assets）なので、差し替えの前の画像を使う'
        : 'ヘッダー画像が期間限定の差し替え（header_alt_assets）なので取り込まない',
    );
  }
  if (header) {
    claims.push(
      makeClaim({
        ...base,
        field: 'image',
        value: {
          url: header,
          role: 'header',
          width: 460,
          height: 215,
          alt: `${display} のヘッダー画像`,
          usage: { basis: 'store-asset', credit: (app.publishers ?? [])[0]?.slice(0, 80) },
        },
        evidence: [ev('steam:appdetails.header_image')],
      }),
    );
  }

  const file: ClaimsFile = structuredClone(repo.claims.get(gameId)) ?? { schemaVersion: 1, gameId, claims: [] };
  let added = 0;
  for (const c of claims) {
    if (SINGLE_VALUE_FIELDS.includes(c.field)) {
      const current = file.claims.find(
        (x) =>
          x.field === c.field && x.status === 'adopted' && scopeKey(x.scope) === scopeKey(c.scope) && x.id !== c.id,
      );
      // 同じストアの、より新しい情報で置き換える（06 §6.8 の同じ順位で新しい根拠）
      if (current) supersede(current, c, at);
    }
    // Steam のヘッダー画像が新しくなったら、前の画像を置き換える（採用済みのヘッダーを2つにしない）
    if (c.field === 'image' && c.value.role === 'header') {
      for (const x of file.claims) {
        if (
          x.field === 'image' &&
          x.status === 'adopted' &&
          x.value.role === 'header' &&
          x.id !== c.id &&
          x.evidence.some((e) => e.locator === 'steam:appdetails.header_image')
        ) {
          supersede(x, c, at);
        }
      }
    }
    if (upsertClaim(file, c)) added++;
  }

  return {
    gameId,
    created: !existing,
    games: [game],
    developers: [...touched.values()],
    claims: file,
    claimsAdded: added,
    notes,
  };
}

/** 体験版、DLC などを本編の associatedApps に加える（04 §4.3.5） */
function attachToParent(repo: RepoData, app: SteamAppDetails, at: string): SeedResult {
  const parentId = Number(app.fullgame?.appid);
  if (!parentId) throw new UserError(`${app.steam_appid} は ${app.type} だが本編の ID が分からない`);
  const parent = repo.games.find((g) => g.status !== 'merged' && g.externalIds.steamAppId === parentId);
  if (!parent) throw new UserError(`${app.steam_appid} の本編（${parentId}）を先に登録する`);
  const kind =
    app.type === 'demo' ? 'demo' : app.type === 'dlc' ? 'dlc' : app.type === 'music' ? 'soundtrack' : 'other';
  const id = String(app.steam_appid);
  const apps = parent.associatedApps.filter((a) => !(a.store === 'steam' && a.id === id));
  apps.push({ store: 'steam', id, kind, title: app.name.slice(0, 120) });
  return {
    gameId: parent.id,
    created: false,
    games: [{ ...parent, associatedApps: apps.slice(0, 30), updatedAt: at }],
    developers: [],
    claimsAdded: 0,
    notes: [`${app.type} として ${parent.id} に加えた`],
  };
}

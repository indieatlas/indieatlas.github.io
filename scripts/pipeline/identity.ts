import type { Developer } from '../../schema/developer.ts';
import type { Game } from '../../schema/game.ts';
import { startOf } from '../lib/partial-date.ts';
import { associatedAppKeys, strongKeys } from '../lib/strong-keys.ts';
import { normalizeTitle } from '../lib/text-normalize.ts';
import type { Claim } from '../../schema/claim.ts';

/** 作品の同定（04 §4.3）。入力は記事やストアから得た手がかり */
export interface IdentityInput {
  titles: string[]; // 表示名、原題、別名
  developerNames: string[];
  externalIds?: Game['externalIds'];
  officialUrl?: string;
  releaseYear?: number;
}

export type IdentityMatch =
  | { kind: 'match'; gameId: string; via: 'strong-key' | 'associated-app' }
  | { kind: 'probable'; gameId: string }
  | { kind: 'ambiguous'; gameIds: string[] }
  | { kind: 'none'; sameNameGameIds: string[] }; // 同名の別作品（区別のメモを付ける）

/** 入力の強いキー */
export function inputStrongKeys(input: IdentityInput): string[] {
  return strongKeys({
    externalIds: input.externalIds ?? {},
    ...(input.officialUrl ? { officialUrl: input.officialUrl } : {}),
  });
}

function titleKeys(g: Game): Set<string> {
  return new Set(
    [g.title.display, g.title.original, ...g.aliases.map((a) => a.value)].map(normalizeTitle).filter(Boolean),
  );
}

function developerKeys(g: Game, devs: Map<string, Developer>): Set<string> {
  const out = new Set<string>();
  for (const id of g.developerIds) {
    const d = devs.get(id);
    if (!d) continue;
    for (const n of [d.name.display, d.name.original, ...d.aliases]) out.add(normalizeTitle(n));
  }
  return out;
}

/** 作品の発売年（採用済みの release のうち最も早いもの） */
function releaseYearOf(claims: Claim[] | undefined): number | undefined {
  const years = (claims ?? [])
    .filter((c) => c.field === 'release' && c.status === 'adopted' && c.value.date)
    .map((c) => Number(startOf((c as Extract<Claim, { field: 'release' }>).value.date!).slice(0, 4)));
  return years.length ? Math.min(...years) : undefined;
}

/** 同じ種類の強いキー（steam: など）で値が違うか */
function conflictingKind(a: string[], b: string[]): boolean {
  const kinds = (keys: string[]) => new Map(keys.map((k) => [k.slice(0, k.indexOf(':')), k]));
  const ka = kinds(a);
  for (const [kind, key] of kinds(b)) {
    if (kind === 'official') continue; // 公式サイトはシリーズで共用されることがある
    const other = ka.get(kind);
    if (other && other !== key) return true;
  }
  return false;
}

export function matchGame(
  input: IdentityInput,
  games: Game[],
  developers: Developer[],
  claimsOf: (gameId: string) => Claim[] | undefined = () => undefined,
): IdentityMatch {
  const active = games.filter((g) => g.status !== 'merged');
  const keys = inputStrongKeys(input);
  // 1. 強いキーが一致する
  for (const g of active) {
    if (strongKeys(g).some((k) => keys.includes(k))) return { kind: 'match', gameId: g.id, via: 'strong-key' };
  }
  // 2. 付属アプリ（体験版、DLC など）と一致する
  for (const g of active) {
    if (associatedAppKeys(g).some((k) => keys.includes(k)))
      return { kind: 'match', gameId: g.id, via: 'associated-app' };
  }
  // 4. 弱いキー（正規化したタイトル）で探す
  const wanted = new Set(input.titles.map(normalizeTitle).filter((t) => t.length > 0));
  const devs = new Map(developers.map((d) => [d.id, d]));
  const hits = active.filter((g) => [...titleKeys(g)].some((t) => wanted.has(t)));
  if (hits.length === 0) return { kind: 'none', sameNameGameIds: [] };
  // 5. 入力に強いキーがあり、同じ種類の強いキーで値が異なる作品は、同名の別作品
  const distinct = keys.length > 0 ? hits.filter((g) => conflictingKind(keys, strongKeys(g))) : [];
  const rest = hits.filter((g) => !distinct.includes(g));
  if (rest.length === 0) return { kind: 'none', sameNameGameIds: distinct.map((g) => g.id) };
  if (rest.length > 1) return { kind: 'ambiguous', gameIds: rest.map((g) => g.id) };
  const g = rest[0]!;
  const inputDevs = new Set(input.developerNames.map(normalizeTitle).filter(Boolean));
  const gameDevs = developerKeys(g, devs);
  if (inputDevs.size > 0 && gameDevs.size > 0) {
    return [...inputDevs].some((d) => gameDevs.has(d))
      ? { kind: 'probable', gameId: g.id }
      : { kind: 'ambiguous', gameIds: [g.id] };
  }
  const year = releaseYearOf(claimsOf(g.id));
  if (inputDevs.size === 0 && input.releaseYear && year && Math.abs(year - input.releaseYear) <= 1) {
    return { kind: 'probable', gameId: g.id };
  }
  return { kind: 'ambiguous', gameIds: [g.id] };
}

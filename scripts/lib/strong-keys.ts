import type { Game } from '../../schema/game.ts';
import { canBeOfficialSite } from './domains.ts';
import { normalizeUrl } from './url-normalize.ts';

/** 公式サイトの URL を、ホスト名に（トップページでなければ）パスを加えたキーにする（04 §4.3.1） */
export function officialKey(url: string): string | undefined {
  if (!canBeOfficialSite(url)) return undefined;
  const u = new URL(normalizeUrl(url));
  return `official:${u.host}${u.pathname === '/' ? '' : u.pathname}`;
}

export function itchKey(url: string): string {
  const u = new URL(normalizeUrl(url));
  return `itch:${u.host}${u.pathname === '/' ? '' : u.pathname}`;
}

/** 作品の強いキー（ストアの ID、itch.io の URL、公式サイトの URL） */
export function strongKeys(game: Pick<Game, 'externalIds' | 'officialUrl'>): string[] {
  const keys: string[] = [];
  const ids = game.externalIds;
  if (ids.steamAppId) keys.push(`steam:${ids.steamAppId}`);
  if (ids.itchUrl) keys.push(itchKey(ids.itchUrl));
  if (ids.igdbId) keys.push(`igdb:${ids.igdbId}`);
  if (ids.epicSlug) keys.push(`epic:${ids.epicSlug}`);
  if (ids.gogId) keys.push(`gog:${ids.gogId}`);
  if (ids.nintendoNsuid) keys.push(`nintendo:${ids.nintendoNsuid}`);
  if (ids.psStoreId) keys.push(`ps:${ids.psStoreId}`);
  if (ids.msStoreId) keys.push(`ms:${ids.msStoreId}`);
  if (ids.appStoreId) keys.push(`appstore:${ids.appStoreId}`);
  if (ids.googlePlayId) keys.push(`googleplay:${ids.googlePlayId}`);
  if (game.officialUrl) {
    const k = officialKey(game.officialUrl);
    if (k) keys.push(k);
  }
  return keys;
}

const STORE_KEY_PREFIX: Record<string, string> = {
  steam: 'steam',
  itch: 'itch',
  epic: 'epic',
  gog: 'gog',
  'nintendo-eshop': 'nintendo',
  'playstation-store': 'ps',
  'microsoft-store': 'ms',
  'app-store': 'appstore',
  'google-play': 'googleplay',
};

/** 付属アプリ（体験版、DLC など）のキー */
export function associatedAppKeys(game: Pick<Game, 'associatedApps'>): string[] {
  return game.associatedApps.map((a) => `${STORE_KEY_PREFIX[a.store] ?? a.store}:${a.id}`);
}

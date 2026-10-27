import type { EvidenceKind } from '../../schema/common.ts';

// 登録可能ドメイン（eTLD+1）の判定に使う、2段の公開サフィックスの一覧（必要に応じて追加する）
const MULTI_PART_SUFFIXES = new Set([
  'co.jp',
  'ne.jp',
  'or.jp',
  'ac.jp',
  'go.jp',
  'gr.jp',
  'co.uk',
  'org.uk',
  'ac.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.kr',
  'or.kr',
  'com.br',
  'com.cn',
  'com.tw',
  'com.hk',
  'co.nz',
  'co.in',
  'com.sg',
  'com.mx',
]);

// サブドメインごとに別の持ち主になるホスティング
const PRIVATE_SUFFIXES = new Set(['itch.io', 'github.io', 'blogspot.com', 'wordpress.com', 'tumblr.com']);

export function registrableDomain(hostOrUrl: string): string {
  const host = (hostOrUrl.includes('://') ? new URL(hostOrUrl).hostname : hostOrUrl).toLowerCase().replace(/\.$/, '');
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const last2 = parts.slice(-2).join('.');
  const take = MULTI_PART_SUFFIXES.has(last2) || PRIVATE_SUFFIXES.has(last2) ? 3 : 2;
  return parts.slice(-take).join('.');
}

const STORE_HOSTS: [RegExp, string][] = [
  [/^store\.steampowered\.com$/, 'steam'],
  [/(^|\.)itch\.io$/, 'itch'],
  [/^store\.epicgames\.com$/, 'epic'],
  [/^www\.gog\.com$/, 'gog'],
  [/^www\.nintendo\.com$/, 'nintendo-eshop'],
  [/^store-jp\.nintendo\.com$/, 'nintendo-eshop'],
  [/^www\.nintendo\.co\.jp$/, 'nintendo-eshop'],
  [/^store\.playstation\.com$/, 'playstation-store'],
  [/^www\.xbox\.com$/, 'microsoft-store'],
  [/^apps\.apple\.com$/, 'app-store'],
  [/^play\.google\.com$/, 'google-play'],
  [/^www\.meta\.com$/, 'meta-quest-store'],
];

/** ストアのドメインなら、そのストアの識別子を返す（05 §5.4.4） */
export function storeOf(url: string): string | undefined {
  const host = new URL(url).hostname.toLowerCase();
  return STORE_HOSTS.find(([re]) => re.test(host))?.[1];
}

// SNS や動画サイトは公式サイトのキーとして扱わない（04 §4.3.1）
const NON_OFFICIAL_DOMAINS = new Set([
  'x.com',
  'twitter.com',
  'facebook.com',
  'instagram.com',
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'discord.gg',
  'discord.com',
  'reddit.com',
  'bsky.app',
  'steampowered.com',
  'steamcommunity.com',
  'twitch.tv',
  'linktr.ee',
  'patreon.com',
  'kickstarter.com',
]);

export function canBeOfficialSite(url: string): boolean {
  if (storeOf(url)) return false;
  return !NON_OFFICIAL_DOMAINS.has(registrableDomain(url));
}

export interface EvidenceKindContext {
  officialUrls: string[]; // 作品と開発者の officialUrl
  sources: { homepage: string; evidenceKind: EvidenceKind }[];
}

/** 情報源として登録していない URL の根拠の種類（05 §5.4.4） */
export function evidenceKindForUrl(url: string, ctx: EvidenceKindContext): EvidenceKind {
  const domain = registrableDomain(url);
  if (ctx.officialUrls.some((u) => registrableDomain(u) === domain)) return 'official';
  if (storeOf(url)) return 'store';
  const source = ctx.sources.find((s) => registrableDomain(s.homepage) === domain);
  if (source) return source.evidenceKind;
  return 'media';
}

/** 独立性を判定するキー（04 §4.5.3） */
export function originKeyFor(kind: EvidenceKind, url: string, derivedFromKey?: string): string {
  if (derivedFromKey) return `pr:${derivedFromKey}`;
  if (kind === 'store') return `store:${storeOf(url) ?? registrableDomain(url)}`;
  return `${kind}:${registrableDomain(url)}`;
}

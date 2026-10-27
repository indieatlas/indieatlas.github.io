import type { AmazonRanking } from '../../schema/amazon.ts';
import type { HttpClient } from '../fetch/http.ts';

/**
 * Amazon Creators API（PA-API 5 の後継）のアダプタ。OAuth 2.0 の Client Credentials でトークンを得て、
 * https://creatorsapi.amazon/catalog/v1/ に POST する。キーは環境変数（ローカルでは .env）からだけ読む。
 * https://affiliate-program.amazon.com/creatorsapi/docs/en-us/get-started/using-curl
 */
export const CREATORS_API = 'https://creatorsapi.amazon/catalog/v1/';
export const MARKETPLACE_JP = 'www.amazon.co.jp';

// 資格情報の版ごとのトークンの窓口（3.1 北米、3.2 欧州、3.3 極東）
const TOKEN_ENDPOINTS: Record<string, string> = {
  '3.1': 'https://api.amazon.com/auth/o2/token',
  '3.2': 'https://api.amazon.co.uk/auth/o2/token',
  '3.3': 'https://api.amazon.co.jp/auth/o2/token',
};

export interface CreatorsCredentials {
  credentialId: string;
  credentialSecret: string;
  version: string;
}

export interface CreatorsClient {
  call<T>(operation: string, body: Record<string, unknown>): Promise<T>;
}

export async function createCreatorsClient(http: HttpClient, cred: CreatorsCredentials): Promise<CreatorsClient> {
  if (!http.post) throw new Error('http client does not support POST');
  const post = http.post.bind(http);
  const endpoint = TOKEN_ENDPOINTS[cred.version];
  if (!endpoint) throw new Error(`unknown Creators API credential version: ${cred.version}`);
  const res = await post(
    endpoint,
    JSON.stringify({
      grant_type: 'client_credentials',
      client_id: cred.credentialId,
      client_secret: cred.credentialSecret,
      scope: 'creatorsapi::default',
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (res.status !== 200) throw new Error(`Creators API token: HTTP ${res.status}`);
  const token = (JSON.parse(res.text) as { access_token?: string }).access_token;
  if (!token) throw new Error('Creators API token: no access_token');
  return {
    async call<T>(operation: string, body: Record<string, unknown>): Promise<T> {
      const r = await post(CREATORS_API + operation, JSON.stringify({ marketplace: MARKETPLACE_JP, ...body }), {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'x-marketplace': MARKETPLACE_JP,
        },
      });
      if (r.status !== 200) throw new Error(`Creators API ${operation}: HTTP ${r.status} ${r.text.slice(0, 200)}`);
      return JSON.parse(r.text) as T;
    },
  };
}

export interface CreatorsItem {
  asin: string;
  detailPageURL?: string;
  images?: { primary?: { large?: { url: string; width: number; height: number } | null } | null } | null;
  itemInfo?: {
    title?: { displayValue?: string } | null;
    classifications?: { productGroup?: { displayValue?: string } | null; binding?: { displayValue?: string } | null } | null;
  } | null;
  browseNodeInfo?: { websiteSalesRank?: { salesRank?: number } | null } | null;
}

export const RANKING_RESOURCES = [
  'itemInfo.title',
  'itemInfo.classifications',
  'images.primary.large',
  'browseNodeInfo.websiteSalesRank',
];

// プリペイドカード、利用券、本体と周辺機器は売れ筋に出さない
const EXCLUDE_TITLE =
  /プリペイド|ポイント|チケット|ギフト|利用券|加入券|メンバーシップ|Nintendo Switch Online|PlayStation\s*Plus|Game\s*Pass|ダウンロード番号|オンラインコード|カード\s*\d|\d[\d,]*\s*円|本体|コントローラー|Joy-Con|プロコン|充電|ケース|カバー|フィルム|ヘッドセット|アダプター|ストラップ|amiibo|攻略本|サウンドトラック/i;
const EXCLUDE_GROUP = /hardware|accessor|gift|digital\s*currency|book|music/i;

export function isGameSoftware(item: CreatorsItem): boolean {
  const title = item.itemInfo?.title?.displayValue ?? '';
  const group = item.itemInfo?.classifications?.productGroup?.displayValue ?? '';
  return !!title && !EXCLUDE_TITLE.test(title) && !EXCLUDE_GROUP.test(group);
}

const PLATFORM_PATTERNS: [RegExp, string][] = [
  [/Switch\s*2/i, 'Nintendo Switch 2'],
  [/Switch/i, 'Nintendo Switch'],
  [/PS5|PlayStation\s*5/i, 'PS5'],
  [/PS4|PlayStation\s*4/i, 'PS4'],
  [/Xbox/i, 'Xbox'],
];

/** 検索結果を売れ筋の順に並べ、ゲームソフトだけを残す（同じ ASIN は1件） */
export function rankingFromItems(items: CreatorsItem[], fetchedAt: string, limit = 30): AmazonRanking {
  const seen = new Set<string>();
  const out: AmazonRanking['items'] = [];
  for (const it of [...items].sort(
    (a, b) =>
      (a.browseNodeInfo?.websiteSalesRank?.salesRank ?? Infinity) -
      (b.browseNodeInfo?.websiteSalesRank?.salesRank ?? Infinity),
  )) {
    const rank = it.browseNodeInfo?.websiteSalesRank?.salesRank;
    if (!rank || !it.detailPageURL || seen.has(it.asin) || !isGameSoftware(it)) continue;
    seen.add(it.asin);
    const title = it.itemInfo!.title!.displayValue!;
    const img = it.images?.primary?.large;
    const platform = PLATFORM_PATTERNS.find(([re]) => re.test(title))?.[1];
    out.push({
      asin: it.asin,
      title: title.slice(0, 300),
      url: it.detailPageURL,
      ...(img ? { image: { url: img.url, width: img.width, height: img.height } } : {}),
      salesRank: rank,
      ...(platform ? { platform } : {}),
    });
    if (out.length >= limit) break;
  }
  return { schemaVersion: 1, fetchedAt, items: out };
}

// 売れ筋を集めるための検索語（家庭用ゲーム機のソフト）
export const RANKING_QUERIES = ['Nintendo Switch 2 ソフト', 'Nintendo Switch ソフト', 'PS5 ソフト', 'PS4 ソフト'];

export async function fetchRanking(client: CreatorsClient, partnerTag: string, fetchedAt: string, pages = 3): Promise<AmazonRanking> {
  const items: CreatorsItem[] = [];
  for (const keywords of RANKING_QUERIES) {
    for (let page = 1; page <= pages; page++) {
      const res = await client.call<{ searchResult?: { items?: CreatorsItem[] } }>('searchItems', {
        keywords,
        searchIndex: 'VideoGames',
        itemCount: 10,
        itemPage: page,
        partnerTag,
        resources: RANKING_RESOURCES,
      });
      items.push(...(res.searchResult?.items ?? []));
    }
  }
  return rankingFromItems(items, fetchedAt);
}

/** 取得から24時間以内なら使ってよい */
export function isFresh(r: AmazonRanking, now: Date): boolean {
  return now.getTime() - Date.parse(r.fetchedAt) < 24 * 3_600_000;
}

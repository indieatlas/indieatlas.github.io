import type { Article } from '../../schema/article.ts';
import type { Evidence } from '../../schema/claim.ts';
import type { Game } from '../../schema/game.ts';
import { originKeyFor } from '../lib/domains.ts';

/**
 * 売れ筋と記事から付けるインディーの理由（11 の決定ログ 2026-11-06）。
 * Steam のインディーの売上上位に入った作品と、収録した記事で取り上げられた作品は、インディーとして収録する。
 * 理由が足りずに公開できない作品だけに付ける（すでにインディーと判定した作品のファイルは変えない）
 */

/** 売上上位を確かめたページ（サイトの売れ筋と同じ条件の検索結果） */
export const TOP_SELLERS_PAGE = 'https://store.steampowered.com/search/?filter=topsellers&category1=998&tags=492&cc=jp';

export function topSellerEvidence(retrievedAt: string): Evidence {
  return {
    kind: 'store',
    url: TOP_SELLERS_PAGE,
    retrievedAt,
    locator: 'steam:search.topsellers.tags=492',
    originKey: 'store:steam',
  };
}

export function coverageEvidence(a: Article): Evidence {
  return {
    kind: 'media',
    url: a.url,
    articleId: a.id,
    ...(a.publishedAt ? { publishedAt: a.publishedAt } : {}),
    retrievedAt: a.retrievedAt,
    locator: 'article.games',
    originKey: originKeyFor('media', a.url, a.derivedFrom?.key),
  };
}

/** 理由を加える。同じ理由がすでにあれば何もしない。加えたら true */
export function addIndieReason(game: Game, code: 'indie-top-seller' | 'indie-coverage', evidence: Evidence): boolean {
  if (game.indie.reasons.some((r) => r.code === code)) return false;
  game.indie.reasons.push({ code, evidence: [evidence] });
  return true;
}

/** 作品を取り上げた記事のうち、最初に収録したもの */
export function firstCoverage(articles: Article[], gameId: string): Article | undefined {
  return articles
    .filter((a) => a.status === 'active' && a.games.some((g) => g.gameId === gameId))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1))[0];
}

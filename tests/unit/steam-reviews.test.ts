import { describe, expect, it } from 'vitest';
import { parseReviewSummary } from '../../scripts/sources/steam.ts';

describe('Steam のレビューの集計', () => {
  it('query_summary を読む', () => {
    const text = JSON.stringify({
      success: 1,
      query_summary: {
        review_score_desc: 'Very Positive',
        total_positive: 940,
        total_negative: 60,
        total_reviews: 1000,
      },
      reviews: [],
    });
    expect(parseReviewSummary(text)).toEqual({ positive: 940, total: 1000, desc: 'Very Positive' });
  });
  it('転送された HTML や失敗の応答は undefined', () => {
    expect(parseReviewSummary('<!DOCTYPE html><html></html>')).toBeUndefined();
    expect(parseReviewSummary('{"success":2}')).toBeUndefined();
    expect(parseReviewSummary('{"success":1,"query_summary":{"total_reviews":0}}')).toBeUndefined();
  });
});

import { parseCommunityReviews, parseStoreReviewScore } from '../../scripts/sources/steam.ts';

describe('Steam のストアとコミュニティのページ', () => {
  it('ストアのページから日本語のレビューの集計を読む', () => {
    const html =
      '<span data-tooltip-html="あなたの言語でのユーザーレビュー2,054件中92%が好評です。"><span class="game_review_summary positive" itemprop="description">非常に好評</span>';
    expect(parseStoreReviewScore(html)).toEqual({
      positive: 1890,
      total: 2054,
      desc: '非常に好評',
      language: 'japanese',
    });
    expect(parseStoreReviewScore('<html></html>')).toBeUndefined();
    // 日本語のレビューが少ない作品は、すべての言語の集計
    expect(
      parseStoreReviewScore(
        'このゲームのユーザーレビュー66,736件中98%が好評です <span class="game_review_summary positive">圧倒的に好評</span>',
      ),
    ).toEqual({ positive: 65401, total: 66736, desc: '圧倒的に好評' });
  });

  it('コミュニティのレビューの一覧を読み、投稿者の ID はハッシュにする', () => {
    const card = (id: string, up: boolean, text: string) =>
      `<div class="apphub_Card modalContentLink" data-modal-content-url="https://steamcommunity.com/profiles/${id}/recommended/9000001/">` +
      `<img src="https://community.akamai.steamstatic.com/public/shared/images/userreviews/icon_thumbs${up ? 'Up' : 'Down'}.png">` +
      `<div class="found_helpful">12 人がこのレビューが参考になったと投票しました</div>` +
      `<div class="apphub_CardTextContent"><div class="date_posted">投稿日: 2026年1月1日</div>${text}</div>\n</div>`;
    const html =
      'x' +
      card('76561190000000001', true, '灯台を巡る探索が&quot;とても&quot;気持ちいい作品でした。') +
      card('76561190000000002', false, '短い');
    const r = parseCommunityReviews(html, 'japanese');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      text: '灯台を巡る探索が"とても"気持ちいい作品でした。',
      votedUp: true,
      votesUp: 12,
      language: 'japanese',
    });
    expect(r[0]!.id).toMatch(/^[0-9a-f]{16}$/);
    expect(r[0]!.id).not.toContain('7656119');
  });
});

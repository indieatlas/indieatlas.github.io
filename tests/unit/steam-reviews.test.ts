import { describe, expect, it } from 'vitest';
import { parseReviewSummary } from '../../scripts/sources/steam.ts';

describe('Steam のレビューの集計', () => {
  it('query_summary を読む', () => {
    const text = JSON.stringify({
      success: 1,
      query_summary: { review_score_desc: 'Very Positive', total_positive: 940, total_negative: 60, total_reviews: 1000 },
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

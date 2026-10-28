import { describe, expect, it } from 'vitest';
import { createFakeLlm, createOpenAiCompatibleClient } from '../../scripts/llm/client.ts';
import { summarizeReviews, validateSummary } from '../../scripts/pipeline/review-summary.ts';
import { parseReviewList, type SteamReview } from '../../scripts/sources/steam.ts';
import type { FetchResult, HttpClient } from '../../scripts/fetch/http.ts';
import { z } from 'zod';

// 架空のレビュー（10 §10.5.1）
const reviews: SteamReview[] = Array.from({ length: 12 }, (_, i) => ({
  id: String(1000 + i),
  text:
    i < 8
      ? `灯台を巡る探索が気持ちよく、音楽がとても良い。レビュー番号${i}`
      : `操作に慣れるまで時間がかかる。後半はやや単調。番号${i}`,
  votedUp: i < 8,
  votesUp: 10 - i,
  language: 'japanese',
}));
const at = { at: '2026-10-28T00:00:00Z', model: 'fake', runId: 'test' };

describe('Steam のレビューの要約', () => {
  it('レビューの一覧を読み、短すぎるものを除く', () => {
    const text = JSON.stringify({
      success: 1,
      reviews: [
        {
          recommendationid: '1',
          review: '[h1]良い[/h1] 探索がとても楽しいゲームでした。',
          voted_up: true,
          votes_up: 3,
          language: 'japanese',
        },
        { recommendationid: '2', review: '良い', voted_up: true, votes_up: 1, language: 'japanese' },
      ],
    });
    expect(parseReviewList(text)!.map((r) => [r.id, r.text])).toEqual([['1', '良い 探索がとても楽しいゲームでした。']]);
    expect(parseReviewList('<html>')).toBeUndefined();
  });

  it('根拠が2件以上で、好評のレビューに支えられた長所だけを残す', async () => {
    const llm = createFakeLlm([
      {
        pros: [
          { text: '探索の手ざわりと音楽の評価が高い', reviewIds: ['1000', '1001', '1002'] },
          { text: '一件だけの意見', reviewIds: ['1003'] },
          { text: '神ゲーと言われている', reviewIds: ['1000', '1001'] },
        ],
        cons: [
          { text: '操作に慣れるまで時間がかかるという声', reviewIds: ['1008', '1009'] },
          { text: '存在しない根拠', reviewIds: ['9999', '8888'] },
        ],
      },
    ]);
    const r = await summarizeReviews(llm, { id: 'g_000001', title: 'Lantern Tide' }, reviews, at);
    expect(r.entry!.pros.map((p) => p.text)).toEqual(['探索の手ざわりと音楽の評価が高い']);
    expect(r.entry!.cons.map((p) => p.text)).toEqual([]);
    expect(r.errors.join('\n')).toContain('根拠が2件未満');
    expect(r.errors.join('\n')).toContain('誇張や主観の表現');
    expect(r.errors.join('\n')).toContain('レビューの文の写し');
    expect(llm.prompts[0]).toContain('"id":"1000"');
  });

  it('レビューが少なければ作らない', async () => {
    const r = await summarizeReviews(createFakeLlm([]), { id: 'g_000001', title: 'x' }, reviews.slice(0, 3), at);
    expect(r.entry).toBeUndefined();
  });

  it('長所が残らなければ失敗にする', () => {
    const v = validateSummary({ pros: [{ text: '短', reviewIds: ['1000', '1001'] }], cons: [] }, reviews);
    expect(v.ok).toBe(false);
  });

  it('OpenAI 互換の接続は JSON モードで送り、形が違えば検証エラーを添えてやり直す', async () => {
    const bodies: string[] = [];
    const headers: Record<string, string>[] = [];
    const answers = ['{"x":1}', '{"value":"ok"}'];
    const ok = (text: string): FetchResult => ({
      url: '',
      status: 200,
      contentType: 'application/json',
      text,
      bytes: new Uint8Array(),
      fetchHash: 'sha256:' + '0'.repeat(64),
      retrievedAt: new Date('2026-10-28T00:00:00Z'),
    });
    const http: HttpClient = {
      get: async () => ok(''),
      post: async (_url, body, init) => {
        bodies.push(body);
        headers.push(init!.headers!);
        return ok(
          JSON.stringify({
            choices: [{ message: { content: answers.shift() } }],
            usage: { prompt_tokens: 10, completion_tokens: 2 },
          }),
        );
      },
    };
    const client = createOpenAiCompatibleClient(http, {
      baseUrl: 'https://llm.example/v1',
      apiKey: 'k',
      sessionHeader: 'x-opencode-session',
      userAgent: 'IndieAtlasBot/0.1',
      model: () => ({ model: 'm', thinking: 'disabled', maxOutputTokens: 100 }),
    });
    const v = await client.generateObject({
      role: 'execute',
      sessionId: 's1',
      system: 'sys',
      prompt: 'p',
      schema: z.object({ value: z.string() }),
    });
    expect(v).toEqual({ value: 'ok' });
    expect(JSON.parse(bodies[0]!).response_format).toEqual({ type: 'json_object' });
    expect(JSON.parse(bodies[1]!).messages.at(-1).content).toContain('形式に合わない');
    expect(headers[0]!['x-opencode-session']).toBe('s1');
  });
});

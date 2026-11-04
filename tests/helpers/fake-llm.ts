import fs from 'node:fs';
import path from 'node:path';
import type { FetchResult, HttpClient } from '../../scripts/fetch/http.ts';
import { now } from '../../scripts/lib/clock.ts';
import { sha256Tagged } from '../../scripts/lib/hash.ts';

/** Chat Completions の応答の形の1件。status を付けると、その HTTP の状態で返す */
export type FakeChatResponse = Record<string, unknown> & { status?: number };

/** assistant がツールを呼ぶ応答 */
export function toolCall(name: string, args: unknown, id = `call_${name}`): FakeChatResponse {
  return {
    model: 'deepseek-v4.1-flash',
    choices: [
      {
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: '',
          reasoning_content: `think about ${name}`,
          tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
        },
      },
    ],
    usage: { prompt_tokens: 1000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 500 } },
  };
}

/** JSON モードの応答 */
export function jsonContent(value: unknown): FakeChatResponse {
  return {
    model: 'deepseek-v4.1-flash',
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(value) } }],
    usage: { prompt_tokens: 500, completion_tokens: 50 },
  };
}

/**
 * 記録した応答を順に返す Fake の LLM の接続先（06 §6.9.5）。
 * シナリオは tests/fixtures/llm/{scenario}.json（応答の配列）からも読める
 */
export function fakeLlmHttp(responses: FakeChatResponse[]): HttpClient & { bodies: Record<string, unknown>[] } {
  const queue = [...responses];
  const bodies: Record<string, unknown>[] = [];
  const reply = (status: number, text: string, url: string): FetchResult => {
    const bytes = new TextEncoder().encode(text);
    return {
      url,
      status,
      contentType: 'application/json',
      text,
      bytes,
      fetchHash: sha256Tagged(bytes),
      retrievedAt: now(),
    };
  };
  return {
    bodies,
    async get(url) {
      return reply(200, JSON.stringify({ data: [{ id: 'deepseek-v4.1-flash' }] }), url);
    },
    async post(url, body) {
      bodies.push(JSON.parse(body));
      const next = queue.shift();
      if (!next) throw new Error('fake llm: no more responses');
      const { status, ...rest } = next;
      return reply(status ?? 200, JSON.stringify(rest), url);
    },
  };
}

export function loadScenario(name: string): FakeChatResponse[] {
  return JSON.parse(fs.readFileSync(path.resolve('tests/fixtures/llm', `${name}.json`), 'utf8'));
}

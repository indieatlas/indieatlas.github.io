import type { z } from 'zod';
import type { HttpClient } from '../fetch/http.ts';

/**
 * LLM の呼び出し（06 §6.9）のうち、構造化出力（generateObject）だけを先に実装したもの。
 * OpenAI 互換の Chat Completions に JSON モードで送り、Zod で検証する。合わなければ検証エラーを添えて2回までやり直す。
 * ツールのループ（runTools）は第2段階（P2）で加える
 */
export type LlmRole = 'triage' | 'plan' | 'execute' | 'resolve';

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
}

export interface GenerateObjectRequest<T> {
  role: LlmRole;
  sessionId: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  onUsage?(usage: LlmUsage): void;
}

export interface LlmClient {
  generateObject<T>(req: GenerateObjectRequest<T>): Promise<T>;
}

export interface OpenAiCompatibleOptions {
  baseUrl: string;
  apiKey: string;
  model: (role: LlmRole) => { model: string; thinking: 'enabled' | 'disabled'; maxOutputTokens: number };
  sessionHeader: string;
  userAgent: string;
}

interface ChatResponse {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    prompt_cache_hit_tokens?: number;
  };
}

export function createOpenAiCompatibleClient(http: HttpClient, o: OpenAiCompatibleOptions): LlmClient {
  if (!http.post) throw new Error('http client does not support POST');
  const post = http.post.bind(http);
  return {
    async generateObject<T>(req: GenerateObjectRequest<T>): Promise<T> {
      const role = o.model(req.role);
      const messages: { role: string; content: string }[] = [
        { role: 'system', content: req.system },
        { role: 'user', content: req.prompt },
      ];
      let lastError = '';
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await post(
          `${o.baseUrl}/chat/completions`,
          JSON.stringify({
            model: role.model,
            messages,
            response_format: { type: 'json_object' },
            max_tokens: role.maxOutputTokens,
            thinking: { type: role.thinking },
            stream: false,
          }),
          {
            headers: {
              Authorization: `Bearer ${o.apiKey}`,
              'Content-Type': 'application/json',
              'User-Agent': o.userAgent,
              [o.sessionHeader]: req.sessionId,
            },
          },
        );
        if (res.status !== 200) throw new Error(`LLM: HTTP ${res.status} ${res.text.slice(0, 200)}`);
        const body = JSON.parse(res.text) as ChatResponse;
        const u = body.usage;
        req.onUsage?.({
          promptTokens: u?.prompt_tokens ?? 0,
          completionTokens: u?.completion_tokens ?? 0,
          cachedTokens: u?.prompt_tokens_details?.cached_tokens ?? u?.prompt_cache_hit_tokens ?? 0,
        });
        const content = body.choices?.[0]?.message?.content ?? '';
        let parsed: unknown;
        try {
          parsed = JSON.parse(content);
        } catch {
          lastError = 'JSON として読めない';
        }
        if (parsed !== undefined) {
          const r = req.schema.safeParse(parsed);
          if (r.success) return r.data;
          lastError = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
        }
        messages.push(
          { role: 'assistant', content },
          { role: 'user', content: `出力が形式に合わない: ${lastError}。形式に合わせて出力し直す。` },
        );
      }
      throw new Error(`LLM: 出力が形式に合わない（${lastError}）`);
    },
  };
}

/** テスト用。決めた応答を順に返す（06 §6.9.5） */
export function createFakeLlm(responses: unknown[]): LlmClient & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    async generateObject<T>(req: GenerateObjectRequest<T>): Promise<T> {
      prompts.push(req.prompt);
      const next = responses.shift();
      if (next === undefined) throw new Error('fake llm: no more responses');
      return req.schema.parse(next);
    },
  };
}

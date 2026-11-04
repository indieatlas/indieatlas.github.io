import { z } from 'zod';
import type { HttpClient } from '../fetch/http.ts';
import { now, toIsoDateTime } from '../lib/clock.ts';

/**
 * LLM の呼び出し（06 §6.9）。OpenAI 互換の Chat Completions（OpenCode Go）に接続する。
 * - generateObject: JSON モードで送り、Zod で検証する。合わなければ検証エラーを添えて2回までやり直す
 * - runTools: ツールのループ。最後に finalTool が呼ばれ、入力がスキーマに合ったら終える（§6.9.2）
 * 会話の履歴は、受け取った assistant の応答（reasoning_content を含む）をそのまま追記して組み立てる
 */
export type LlmRole = 'triage' | 'plan' | 'execute' | 'resolve';

export interface LlmUsage {
  model: string;
  startedAt: string; // リクエストの開始時刻（UTC）。単価の時間帯の判定に使う
  promptTokens: number; // キャッシュに当たった分を含む入力
  completionTokens: number; // 思考のトークンを含む
  cachedTokens: number;
  reasoningTokens: number;
  allowanceUsd?: number; // OpenCode Go が返す、プランの利用額に数えた額（usage.opencode.allowance）
}

export interface GenerateObjectRequest<T> {
  role: LlmRole;
  sessionId: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  signal?: AbortSignal;
  onUsage?(usage: LlmUsage): void;
}

export interface ToolSpec<I = unknown> {
  name: string;
  description: string;
  input: z.ZodType<I>;
  run(input: I): Promise<{ ok: true; content: string } | { ok: false; error: string }>;
}

export type RunToolsStop = 'final' | 'max-turns' | 'budget' | 'deadline' | 'refusal' | 'provider-limit' | 'error';

export interface RunToolsRequest<T> {
  role: LlmRole;
  sessionId: string;
  system: string;
  prompt: string;
  tools: ToolSpec<any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  finalTool: { name: string; description: string; schema: z.ZodType<T>; parameters?: unknown };
  maxTurns: number;
  signal?: AbortSignal;
  /**
   * 呼び出しの前に、見積もり（USD）を渡して続けてよいかを聞く。false なら呼び出さない。
   * 'final' なら、結果の提出を促してから最後の1回だけ呼び出す（1タスクの上限に達したとき）
   */
  beforeTurn?(estimateUsd: number, lastPromptTokens: number): boolean | 'final';
  onUsage?(usage: LlmUsage): void;
  onTranscript?(entry: unknown): void;
  /** 見積もりの単価（USD/100万トークン） */
  estimateRates?: { input: number; output: number };
}

export interface RunToolsResult<T> {
  value: T | null;
  stop: RunToolsStop;
  error?: string;
  turns: number;
}

export interface LlmClient {
  generateObject<T>(req: GenerateObjectRequest<T>): Promise<T>;
  runTools?<T>(req: RunToolsRequest<T>): Promise<RunToolsResult<T>>;
}

/** 呼び出しの失敗の種類（§6.9.2 の「エラー」） */
export class LlmError extends Error {
  override name = 'LlmError';
  constructor(
    message: string,
    readonly kind: 'auth' | 'provider-limit' | 'bad-request' | 'server' | 'timeout' | 'aborted',
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface OpenAiCompatibleOptions {
  baseUrl: string;
  apiKey: string;
  model: (role: LlmRole) => {
    model: string;
    thinking: 'enabled' | 'disabled';
    maxOutputTokens: number;
    reasoningEffort?: string | null;
  };
  sessionHeader: string;
  userAgent: string;
  /** 429、5xx、接続エラーのときの再試行の回数（既定は2） */
  retries?: number;
  retryDelayMs?: number;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  reasoning_content?: string;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

interface ChatResponse {
  model?: string;
  choices?: { message?: ChatMessage; finish_reason?: string }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
    prompt_cache_hit_tokens?: number;
    opencode?: { allowance?: number };
  };
}

/** Zod のスキーマを、ツールの parameters に渡す JSON Schema にする（接続先が扱えない記法は外す） */
export function toolParameters(schema: z.ZodType): unknown {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  delete json.$schema;
  return stripFormats(json);
}

function stripFormats(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripFormats);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === 'format' || k === 'pattern') continue; // 形式の確認は受け取った後に Zod で行う
      out[k] = stripFormats(x);
    }
    return out;
  }
  return v;
}

function zodIssues(e: z.ZodError): string {
  return e.issues
    .slice(0, 8)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createOpenAiCompatibleClient(http: HttpClient, o: OpenAiCompatibleOptions): LlmClient {
  if (!http.post) throw new Error('http client does not support POST');
  const post = http.post.bind(http);
  const retries = o.retries ?? 2;

  const chat = async (
    role: LlmRole,
    sessionId: string,
    body: Record<string, unknown>,
    signal: AbortSignal | undefined,
  ): Promise<{ res: ChatResponse; usage: LlmUsage }> => {
    const r = o.model(role);
    const payload = JSON.stringify({
      model: r.model,
      max_tokens: r.maxOutputTokens,
      thinking: { type: r.thinking },
      ...(r.reasoningEffort ? { reasoning_effort: r.reasoningEffort } : {}),
      stream: false,
      ...body,
    });
    let last: LlmError | undefined;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (signal?.aborted) throw new LlmError('aborted', 'aborted');
      const startedAt = toIsoDateTime(now());
      let status = 0;
      let text = '';
      try {
        const res = await post(`${o.baseUrl}/chat/completions`, payload, {
          headers: {
            Authorization: `Bearer ${o.apiKey}`,
            'Content-Type': 'application/json',
            'User-Agent': o.userAgent,
            ...(o.sessionHeader ? { [o.sessionHeader]: sessionId } : {}),
          },
        });
        status = res.status;
        text = res.text;
      } catch (e) {
        last = new LlmError(
          `LLM: ${(e as Error).message}`,
          /timeout|abort/i.test((e as Error).message) ? 'timeout' : 'server',
        );
        if (attempt < retries) await sleep((o.retryDelayMs ?? 2000) * (attempt + 1));
        continue;
      }
      if (status === 200) {
        const res = JSON.parse(text) as ChatResponse;
        const u = res.usage;
        const usage: LlmUsage = {
          model: res.model ?? r.model,
          startedAt,
          promptTokens: u?.prompt_tokens ?? 0,
          completionTokens: u?.completion_tokens ?? 0,
          cachedTokens: u?.prompt_tokens_details?.cached_tokens ?? u?.prompt_cache_hit_tokens ?? 0,
          reasoningTokens: u?.completion_tokens_details?.reasoning_tokens ?? 0,
          ...(typeof u?.opencode?.allowance === 'number' ? { allowanceUsd: u.opencode.allowance } : {}),
        };
        return { res, usage };
      }
      const detail = `LLM: HTTP ${status} ${text.slice(0, 200)}`;
      if (status === 401 || status === 403) throw new LlmError(detail, 'auth', status);
      if (status === 400 || status === 422) throw new LlmError(detail, 'bad-request', status);
      last = new LlmError(detail, status === 429 ? 'provider-limit' : 'server', status);
      if (attempt < retries) await sleep((o.retryDelayMs ?? 2000) * (attempt + 1));
    }
    throw last ?? new LlmError('LLM: unknown error', 'server');
  };

  return {
    async generateObject<T>(req: GenerateObjectRequest<T>): Promise<T> {
      const messages: ChatMessage[] = [
        { role: 'system', content: req.system },
        { role: 'user', content: req.prompt },
      ];
      let lastError = '';
      for (let attempt = 0; attempt < 3; attempt++) {
        const { res, usage } = await chat(
          req.role,
          req.sessionId,
          { messages, response_format: { type: 'json_object' } },
          req.signal,
        );
        req.onUsage?.(usage);
        const content = res.choices?.[0]?.message?.content ?? '';
        let parsed: unknown;
        try {
          parsed = JSON.parse(content);
        } catch {
          lastError = 'JSON として読めない';
        }
        if (parsed !== undefined) {
          const r = req.schema.safeParse(parsed);
          if (r.success) return r.data;
          lastError = zodIssues(r.error);
        }
        messages.push(
          { role: 'assistant', content },
          { role: 'user', content: `出力が形式に合わない: ${lastError}。形式に合わせて出力し直す。` },
        );
      }
      throw new Error(`LLM: 出力が形式に合わない（${lastError}）`);
    },

    async runTools<T>(req: RunToolsRequest<T>): Promise<RunToolsResult<T>> {
      const toolDefs = [
        ...req.tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: toolParameters(t.input) },
        })),
        {
          type: 'function',
          function: {
            name: req.finalTool.name,
            description: req.finalTool.description,
            parameters: req.finalTool.parameters ?? toolParameters(req.finalTool.schema),
          },
        },
      ];
      const byName = new Map(req.tools.map((t) => [t.name, t]));
      const messages: ChatMessage[] = [
        { role: 'system', content: req.system },
        { role: 'user', content: req.prompt },
      ];
      const rates = req.estimateRates ?? { input: 0.3, output: 1.2 };
      let lastPrompt = 0;
      let invalidFinal = 0;
      let nudged = false;
      let turns = 0;
      for (; turns < req.maxTurns + 1; turns++) {
        if (req.signal?.aborted) return { value: null, stop: 'deadline', turns };
        // 最後の1回は、今ある情報で結果を出させる
        if (turns === req.maxTurns) {
          if (nudged) break;
          messages.push({
            role: 'user',
            content: `ツールの回数の上限に達した。今ある情報で ${req.finalTool.name} を呼び、結果を返す。`,
          });
          nudged = true;
        }
        const estimate = ((lastPrompt + 4000) * rates.input + 4000 * rates.output) / 1_000_000;
        const gate = req.beforeTurn ? req.beforeTurn(estimate, lastPrompt) : true;
        if (gate === false || (gate === 'final' && nudged)) return { value: null, stop: 'budget', turns };
        if (gate === 'final') {
          messages.push({
            role: 'user',
            content: `予算の上限に近い。今ある情報で ${req.finalTool.name} を呼び、結果を返す。`,
          });
          nudged = true;
        }
        let res: ChatResponse;
        try {
          const r = await chat(req.role, req.sessionId, { messages, tools: toolDefs, tool_choice: 'auto' }, req.signal);
          res = r.res;
          lastPrompt = r.usage.promptTokens;
          req.onUsage?.(r.usage);
        } catch (e) {
          const err = e as LlmError;
          req.onTranscript?.({ error: err.message, kind: err.kind });
          if (err.kind === 'provider-limit') return { value: null, stop: 'provider-limit', error: err.message, turns };
          if (err.kind === 'aborted' || err.kind === 'timeout')
            return { value: null, stop: req.signal?.aborted ? 'deadline' : 'error', error: err.message, turns };
          throw e; // auth はクライアントごと無効にするため、呼び出し側に伝える
        }
        const choice = res.choices?.[0];
        const msg = choice?.message ?? { role: 'assistant', content: '' };
        const assistant: ChatMessage = {
          role: 'assistant',
          content: msg.content ?? '',
          ...(msg.reasoning_content !== undefined ? { reasoning_content: msg.reasoning_content } : {}),
          ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}),
        };
        messages.push(assistant);
        req.onTranscript?.({ assistant, finish: choice?.finish_reason });
        if (choice?.finish_reason === 'content_filter') return { value: null, stop: 'refusal', turns: turns + 1 };
        if (choice?.finish_reason === 'length' && !msg.tool_calls?.length) {
          messages.pop();
          messages.push({
            role: 'user',
            content: `出力が長すぎて途切れた。短くまとめて ${req.finalTool.name} を呼ぶ。`,
          });
          continue;
        }
        const calls = msg.tool_calls ?? [];
        if (calls.length === 0) {
          if (nudged) break;
          messages.push({ role: 'user', content: `${req.finalTool.name} を呼んで結果を返す。` });
          nudged = true;
          continue;
        }
        let final: T | null = null;
        for (const call of calls) {
          let args: unknown;
          try {
            args = JSON.parse(call.function.arguments || '{}');
          } catch {
            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: JSON.stringify({ error: 'arguments are not valid JSON' }),
            });
            continue;
          }
          if (call.function.name === req.finalTool.name) {
            const r = req.finalTool.schema.safeParse(args);
            if (r.success) {
              final = r.data;
              messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ accepted: true }) });
            } else {
              invalidFinal++;
              messages.push({
                role: 'tool',
                tool_call_id: call.id,
                content: JSON.stringify({ accepted: false, error: zodIssues(r.error) }),
              });
            }
            continue;
          }
          const tool = byName.get(call.function.name);
          if (!tool) {
            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: JSON.stringify({ error: `unknown tool ${call.function.name}` }),
            });
            continue;
          }
          const parsed = tool.input.safeParse(args);
          if (!parsed.success) {
            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: JSON.stringify({ error: zodIssues(parsed.error) }),
            });
            continue;
          }
          const out = await tool.run(parsed.data).catch((e: Error) => ({ ok: false as const, error: e.message }));
          req.onTranscript?.({ tool: call.function.name, args, ok: out.ok });
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: out.ok ? out.content : JSON.stringify({ error: out.error }),
          });
        }
        if (final !== null) return { value: final, stop: 'final', turns: turns + 1 };
        // 結果の形式の誤りは2回まで直させる
        if (invalidFinal > 2)
          return { value: null, stop: 'error', error: 'final tool input invalid', turns: turns + 1 };
      }
      return { value: null, stop: 'max-turns', turns };
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

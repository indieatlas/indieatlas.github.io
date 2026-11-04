import type { FetchResult, HttpClient } from '../../scripts/fetch/http.ts';
import { now } from '../../scripts/lib/clock.ts';
import { sha256Tagged } from '../../scripts/lib/hash.ts';

/**
 * 要求の内容で応答を選ぶ Fake の LLM の接続先。実行するタスクの数や順番が変わっても動くよう、
 * triage、plan、タスクの実行を見分け、タスクの実行ではタスクと何回目の応答かで台本を引く
 */
export interface ChatMessage {
  role: string;
  content: string | null;
  reasoning_content?: string;
  tool_calls?: { id: string; function: { name: string; arguments: string } }[];
}

export interface Request {
  system: string;
  messages: ChatMessage[];
  body: Record<string, unknown>;
}

export type Reply = { content: string } | { tool: string; args: unknown };

export interface Script {
  triage(items: { itemKey: string; title: string }[]): unknown;
  /** タスクの実行。task は最初の user メッセージの task。step は assistant の応答の数 */
  execute(task: { taskId: string; type: string; target: Record<string, unknown> }, step: number, req: Request): Reply;
}

export function routedLlmHttp(script: Script): HttpClient & { requests: Request[] } {
  const requests: Request[] = [];
  const reply = (status: number, value: unknown, url: string): FetchResult => {
    const text = JSON.stringify(value);
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
  const usage = { prompt_tokens: 2000, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 1000 } };
  return {
    requests,
    async get(url) {
      return reply(200, { data: [{ id: 'deepseek-v4.1-flash' }] }, url);
    },
    async post(url, raw) {
      const body = JSON.parse(raw) as { messages: ChatMessage[] };
      const system = body.messages[0]!.content ?? '';
      const req = { system, messages: body.messages, body };
      requests.push(req);
      const user = JSON.parse(body.messages[1]!.content ?? '{}');
      const json = (v: unknown) =>
        reply(
          200,
          {
            model: 'deepseek-v4.1-flash',
            choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(v) } }],
            usage,
          },
          url,
        );
      if (system.includes('# 仕分け（triage）')) return json(script.triage(user.items));
      if (system.includes('# 調査の計画（plan）')) {
        return json({
          selected: (user.baseline as string[]).map((taskId) => ({ taskId, why: 'baseline' })),
          newTasks: [],
          notes: '',
        });
      }
      const step = body.messages.filter((m) => m.role === 'assistant').length;
      const r = script.execute(user.task, step, req);
      if ('content' in r) {
        return reply(
          200,
          {
            model: 'deepseek-v4.1-flash',
            choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: r.content } }],
            usage,
          },
          url,
        );
      }
      return reply(
        200,
        {
          model: 'deepseek-v4.1-flash',
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                content: '',
                reasoning_content: `step ${step}`,
                tool_calls: [
                  {
                    id: `call_${step}`,
                    type: 'function',
                    function: { name: r.tool, arguments: JSON.stringify(r.args) },
                  },
                ],
              },
            },
          ],
          usage,
        },
        url,
      );
    },
  };
}

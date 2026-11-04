import type { RuntimeConfig } from '../../schema/config.ts';
import { createSimpleHttp, type HttpClient } from '../fetch/http.ts';
import { createOpenAiCompatibleClient, type LlmClient } from './client.ts';

/**
 * 設定と環境変数から LLM の接続を作る（06 §6.9.1）。
 * INDIEATLAS_LLM_ENABLED=false か、API キーがなければ undefined（LLM を使わない collect-only の動作）
 */
export function createLlmClient(
  runtime: RuntimeConfig,
  env: NodeJS.ProcessEnv,
  opts: { http?: HttpClient; userAgent: string },
): { client?: LlmClient; disabledReason?: string } {
  if ((env.INDIEATLAS_LLM_ENABLED ?? 'true').toLowerCase() === 'false') {
    return { disabledReason: 'INDIEATLAS_LLM_ENABLED=false' };
  }
  const apiKey = env[runtime.llm.apiKeyEnv];
  if (!apiKey) return { disabledReason: `${runtime.llm.apiKeyEnv} is not set` };
  const roles = runtime.llm.roles;
  const http =
    opts.http ??
    createSimpleHttp({
      userAgent: opts.userAgent,
      minIntervalMs: 0,
      timeoutMs: runtime.llm.requestTimeoutSeconds * 1000,
      maxBytes: 10_000_000,
    });
  return {
    client: createOpenAiCompatibleClient(http, {
      baseUrl: runtime.llm.baseUrl,
      apiKey,
      sessionHeader: runtime.llm.sessionHeader,
      userAgent: opts.userAgent,
      model: (role) => ({
        model: roles[role].model,
        thinking: roles[role].thinking,
        maxOutputTokens: roles[role].maxOutputTokens,
        reasoningEffort: roles[role].reasoningEffort,
      }),
    }),
  };
}

/** 起動時に、設定したモデルが接続先の一覧にあるかを確かめる（§6.9.2）。確かめられなければ true */
export async function modelsAvailable(runtime: RuntimeConfig, http: HttpClient, apiKey: string): Promise<boolean> {
  try {
    const res = await http.get(runtime.llm.modelsUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (res.status !== 200) return true;
    const ids = new Set(((JSON.parse(res.text) as { data?: { id: string }[] }).data ?? []).map((m) => m.id));
    if (ids.size === 0) return true;
    return Object.values(runtime.llm.roles).every((r) => ids.has(r.model));
  } catch {
    return true;
  }
}

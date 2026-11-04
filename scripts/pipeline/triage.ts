import { z } from 'zod';
import { ArticleKind } from '../../schema/common.ts';
import type { CollectedItem } from '../../schema/research-output.ts';
import type { LlmClient, LlmUsage } from '../llm/client.ts';

/** triage（06 §6.5.1、R3）。新着記事を、タイトルとフィードの説明だけで仕分ける。本文は取得しない */

export const TriageOutput = z.object({
  items: z.array(
    z.object({
      itemKey: z.string(),
      relevant: z.enum(['yes', 'no', 'maybe']), // インディーゲームを扱う記事か
      mentionedGames: z.array(z.string().max(120)).max(10),
      kindGuess: ArticleKind,
      reason: z.string().max(60),
    }),
  ),
});
export type TriageOutput = z.infer<typeof TriageOutput>;

export const TRIAGE_BATCH = 15;
const TRIAGE_CONCURRENCY = 3;

export function triagePrompt(
  items: CollectedItem[],
  outletName: (sourceId: string) => string,
  knownTitles: string[],
): string {
  return JSON.stringify(
    {
      instructions:
        '各項目について、インディーゲーム（小規模な独立開発、個人制作の作品）を扱う記事かを判定する。大手の作品だけの記事、ハードウェア、セールの告知、配信や芸能のニュースは no。迷えば maybe。mentionedGames には記事が扱う作品名を原文の表記で入れる。',
      knownTitles: knownTitles.slice(0, 400),
      items: items.map((i) => ({
        itemKey: i.itemKey,
        outlet: outletName(i.sourceId),
        title: i.title,
        description: i.description ?? '',
        categories: i.categories,
      })),
      outputShape: {
        items: [
          {
            itemKey: '入力の itemKey',
            relevant: 'yes|no|maybe',
            mentionedGames: ['作品名'],
            kindGuess: ArticleKind.options.join('|'),
            reason: '60字以内',
          },
        ],
      },
    },
    null,
    0,
  );
}

/** 失敗したバッチは、すべてを maybe として扱う */
export async function triageItems(
  llm: LlmClient | undefined,
  items: CollectedItem[],
  opts: {
    system: string;
    runId: string;
    outletName: (sourceId: string) => string;
    knownTitles: string[];
    onUsage?: (u: LlmUsage, sessionId: string) => void;
    canCall?: () => boolean;
    log?: (line: string) => void;
  },
): Promise<CollectedItem[]> {
  const batches: CollectedItem[][] = [];
  for (let i = 0; i < items.length; i += TRIAGE_BATCH) batches.push(items.slice(i, i + TRIAGE_BATCH));
  const results: CollectedItem[][] = new Array(batches.length);
  const one = async (n: number) => {
    const batch = batches[n]!;
    const sessionId = `ia-${opts.runId}-triage-${n + 1}`;
    let result: TriageOutput | undefined;
    if (llm && (opts.canCall?.() ?? true)) {
      try {
        result = await llm.generateObject({
          role: 'triage',
          sessionId,
          system: opts.system,
          prompt: triagePrompt(batch, opts.outletName, opts.knownTitles),
          schema: TriageOutput,
          onUsage: (u) => opts.onUsage?.(u, sessionId),
        });
      } catch (e) {
        opts.log?.(`triage ${sessionId}: ${(e as Error).message}`);
      }
    }
    results[n] = batch.map((item) => {
      const r = result?.items.find((x) => x.itemKey === item.itemKey);
      return {
        ...item,
        triage: r
          ? { relevant: r.relevant, mentionedGames: r.mentionedGames, kindGuess: r.kindGuess, reason: r.reason }
          : { relevant: 'maybe' as const, mentionedGames: [], kindGuess: 'other' as const, reason: 'triage failed' },
      };
    });
  };
  // 3つのバッチずつ並行して送る
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(TRIAGE_CONCURRENCY, batches.length) }, async () => {
      while (next < batches.length) await one(next++);
    }),
  );
  const out = results.flat();
  return out;
}

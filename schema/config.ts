import { z } from 'zod';
import { EvidenceKind, HttpUrl, IsoDate, Lang, SourceId } from './common.ts';

const Role = z.object({
  model: z.string().min(1),
  thinking: z.enum(['enabled', 'disabled']),
  reasoningEffort: z.string().nullable(),
  maxOutputTokens: z.number().int().positive(),
});

const Pricing = z.object({ input: z.number(), output: z.number(), cacheRead: z.number() });
const HourMinute = z.string().regex(/^\d{2}:\d{2}$/);

export const RuntimeConfig = z.object({
  schemaVersion: z.literal(1),
  run: z.object({
    softDeadlineMinutes: z.number().positive(),
    hardDeadlineMinutes: z.number().positive(),
    maxTasks: z.number().int().min(1),
    maxTasksPerGame: z.number().int().min(1),
    executeConcurrency: z.number().int().min(1),
  }),
  limits: z.object({
    maxNewArticles: z.number().int().min(0),
    maxNewGames: z.number().int().min(0),
    maxNewlyPublishedGames: z.number().int().min(0),
    maxFetchesPerTask: z.number().int().min(1),
    maxOperationsPerTask: z.number().int().min(1),
    maxFollowUpTasksPerTask: z.number().int().min(0),
  }),
  exploration: z.object({
    minTaskShare: z.number().min(0).max(1),
    lowCoverageArticleThreshold: z.number().int().min(0),
  }),
  budget: z.object({
    currency: z.literal('USD'),
    monthlyLimit: z.number().min(0),
    perRunLimit: z.number().min(0),
    perTaskLimit: z.number().min(0),
  }),
  llm: z.object({
    provider: z.enum(['opencode-go', 'fake']),
    baseUrl: HttpUrl,
    apiKeyEnv: z.string().min(1),
    sessionHeader: z.string().min(1),
    modelsUrl: HttpUrl,
    roles: z.object({ triage: Role, plan: Role, execute: Role, resolve: Role }),
    pricingUsdPerMTok: z.record(z.string(), z.object({ offPeak: Pricing, peak: Pricing })),
    peakHoursUtc: z.object({
      days: z.array(z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])),
      ranges: z.array(z.tuple([HourMinute, HourMinute])),
    }),
    plan: z.object({ name: z.string(), monthlyAllowanceUsd: z.record(z.string(), z.number()) }),
    maxTurnsPerTask: z.number().int().min(1),
    requestTimeoutSeconds: z.number().int().min(1),
  }),
  fetch: z.object({
    userAgent: z.string().min(1),
    timeoutSeconds: z.number().int().min(1),
    maxBytes: z.number().int().min(1),
    perDomainMinIntervalMs: z.number().int().min(0),
    maxTextChars: z.number().int().min(1),
  }),
  publish: z.object({
    candidateTagMinGames: z.number().int().min(1),
    autoPublishNewCollections: z.boolean(),
    autoMergeGames: z.boolean(),
  }),
  evidence: z.object({ storeQuotes: z.boolean(), maxQuoteChars: z.number().int().min(8).max(200) }),
  retention: z.object({ seenUrlDays: z.number().int().min(1), doneTaskDays: z.number().int().min(1) }),
});
export type RuntimeConfig = z.infer<typeof RuntimeConfig>;

export const SourceConfig = z
  .object({
    id: SourceId,
    name: z.string().min(1).max(80),
    homepage: HttpUrl,
    lang: Lang,
    role: z.enum(['discover', 'understand', 'resolve']),
    kind: z.enum(['media', 'store', 'event', 'developer', 'database']),
    evidenceKind: EvidenceKind, // この情報源から得た根拠の種類
    enabled: z.boolean(),
    fetch: z.object({
      method: z.enum(['rss', 'atom', 'sitemap', 'json-api', 'html-list', 'steam', 'manual']),
      url: HttpUrl.optional(), // manual 以外では必須
      frequency: z.enum(['every-run', 'daily', 'weekly']),
      maxItemsPerRun: z.number().int().min(1).max(100),
      minIntervalMs: z.number().int().min(1000).optional(), // 既定は runtime.json の fetch.perDomainMinIntervalMs
      listSelector: z.string().max(200).optional(), // html-list で、項目のリンクを選ぶ CSS セレクター
    }),
    filters: z
      .object({
        includeKeywords: z.array(z.string()).max(50).optional(), // どれかを含む項目だけを扱う
        excludeKeywords: z.array(z.string()).max(50).optional(),
        includeCategories: z.array(z.string()).max(50).optional(), // RSS の category など
        excludeCategories: z.array(z.string()).max(50).optional(),
      })
      .optional(),
    rights: z.object({
      termsUrl: HttpUrl.optional(),
      checkedAt: IsoDate.optional(), // 人が利用条件を確認した日。enabled: true には必須
      checkedBy: z.string().max(80).optional(),
      allowFetch: z.boolean(), // 自動取得してよいか
      displayTitle: z.boolean(), // 記事の見出しを表示してよいか
      displaySummary: z.boolean(), // 当サイトが書いた短い説明を表示してよいか
      displayImages: z.boolean(), // この情報源の画像を表示してよいか
      storeQuotes: z.boolean(), // 根拠の抜粋を保存してよいか
      notes: z.string().max(500),
    }),
  })
  .superRefine((s, ctx) => {
    if (s.fetch.method !== 'manual' && s.fetch.method !== 'steam' && !s.fetch.url) {
      ctx.addIssue({ code: 'custom', message: 'fetch.url is required unless method is manual or steam' });
    }
  });
export type SourceConfig = z.infer<typeof SourceConfig>;

export const SourcesFile = z.object({ schemaVersion: z.literal(1), sources: z.array(SourceConfig) });
export type SourcesFile = z.infer<typeof SourcesFile>;

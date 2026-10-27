import { z } from 'zod';
import { IsoDateTime, Sha256 } from './common.ts';

export const BuildManifest = z.object({
  schemaVersion: z.literal(1),
  site: z.string().min(1),
  contentHash: Sha256,
  hashInputs: z.object({
    siteData: Sha256,
    code: z.record(z.string(), z.string()),
    env: z.object({ SITE_URL: z.string(), BASE_PATH: z.string() }),
  }),
  sourceCommit: z.string(),
  triggerCommit: z.string(),
  runId: z.string(),
  runAttempt: z.number().int().min(1),
  workflow: z.string(),
  builtAt: IsoDateTime,
  siteUrl: z.string(),
  basePath: z.string(),
  counts: z.object({ games: z.number().int(), articles: z.number().int(), collections: z.number().int() }),
  distBytes: z.number().int().min(0),
  movedTo: z.string().optional(),
});
export type BuildManifest = z.infer<typeof BuildManifest>;

import { z } from 'zod';
import { Evidence } from './claim.ts';
import { Actor, DeveloperId, HttpUrl, IsoDateTime, RunId } from './common.ts';

export const Developer = z.object({
  schemaVersion: z.literal(1),
  id: DeveloperId,
  name: z.object({ display: z.string().min(1).max(80), original: z.string().min(1).max(80) }),
  aliases: z.array(z.string().max(80)).max(20),
  roles: z.array(z.enum(['developer', 'publisher'])).min(1),
  officialUrl: HttpUrl.optional(),
  links: z
    .array(
      z.object({
        kind: z.enum([
          'website',
          'x',
          'bluesky',
          'youtube',
          'steam-developer',
          'steam-publisher',
          'itch',
          'press-kit',
          'other',
        ]),
        url: HttpUrl,
      }),
    )
    .max(20),
  independence: z.object({
    status: z.enum(['independent', 'affiliated', 'major', 'unknown']),
    setBy: Actor,
    note: z.string().max(200).optional(),
    evidence: z.array(Evidence).max(5),
  }),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  createdByRun: RunId,
});
export type Developer = z.infer<typeof Developer>;

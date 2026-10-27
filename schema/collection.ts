import { z } from 'zod';
import {
  Actor,
  ClaimId,
  CollectionId,
  GameId,
  IsoDate,
  IsoDateTime,
  Platform,
  PlayerMode,
  ReleaseStatus,
  Support,
  TagId,
} from './common.ts';

export const CollectionRules = z
  .object({
    allTags: z.array(TagId).max(5).optional(), // すべてを満たす
    anyTags: z.array(TagId).max(10).optional(), // いずれかを満たす
    excludeTags: z.array(TagId).max(10).optional(),
    platforms: z.array(Platform).optional(), // いずれかの機種で発売中または発売予定
    releaseStatuses: z.array(ReleaseStatus).optional(),
    japaneseInterface: z.array(Support).optional(),
    playerModes: z.array(PlayerMode).optional(),
  })
  .strict();
export type CollectionRules = z.infer<typeof CollectionRules>;

export const Collection = z.object({
  schemaVersion: z.literal(1),
  id: CollectionId,
  status: z.enum(['draft', 'published', 'archived']),
  title: z.string().min(2).max(40),
  lede: z.string().min(10).max(120),
  description: z.string().max(1000), // Markdown
  criteria: z.object({
    text: z.string().min(10).max(400), // 選定条件（人が読む文章）
    rules: CollectionRules.optional(), // コードで確かめられる部分
  }),
  items: z
    .array(
      z.object({
        gameId: GameId,
        reason: z.string().min(20).max(120), // この作品を含めた理由
        evidenceClaimIds: z.array(ClaimId).max(5), // 理由を支える採用済みの Claim
        addedAt: IsoDate,
        addedBy: Actor,
        position: z.number().int().min(0),
      }),
    )
    .max(60),
  order: z.enum(['curated', 'added-desc', 'release-desc']),
  featured: z.boolean(),
  createdBy: Actor,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Collection = z.infer<typeof Collection>;

export const MIN_PUBLISHED_COLLECTION_ITEMS = 4;

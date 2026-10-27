import { z } from 'zod';
import { Actor, IsoDateTime, TagGroup, TagId } from './common.ts';

export const Tag = z.object({
  id: TagId, // 例: roguelike、deck-building、cozy
  label: z.object({ ja: z.string().min(1).max(30), en: z.string().min(1).max(40) }),
  aliases: z.array(z.string().max(40)).max(20),
  group: TagGroup,
  definition: z.string().min(10).max(200),
  status: z.enum(['core', 'candidate', 'deprecated']),
  mergedInto: TagId.optional(), // deprecated のときの統合先
  createdBy: Actor,
  createdAt: IsoDateTime,
});
export type Tag = z.infer<typeof Tag>;

export const TagsFile = z.object({ schemaVersion: z.literal(1), tags: z.array(Tag) }); // id の順
export type TagsFile = z.infer<typeof TagsFile>;

/** アトラスの特徴ベクトルに使う、タグの系統ごとの係数（02 §2.7.4） */
export const TAG_GROUP_WEIGHTS: Record<z.infer<typeof TagGroup>, number> = {
  genre: 1.0,
  mechanic: 0.8,
  'play-style': 0.7,
  theme: 0.6,
  mood: 0.6,
  setting: 0.5,
  'art-style': 0.4,
};

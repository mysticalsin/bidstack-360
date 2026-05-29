import { z } from 'zod';

/**
 * Sprint 1 — Krayin import.
 * Tag entity + polymorphic EntityTag join. The taggable surface is closed:
 * we list it here (not in Prisma) because Prisma has no native polymorphism
 * and we want the type set to live with the consumer schemas, not buried in
 * the database layer.
 */

export const TaggableEntityType = z.enum([
  'lead',
  'account',
  'contact',
  'opportunity',
  'bid_opportunity',
  'activity',
  'task',
  'proposal',
]);
export type TaggableEntityType = z.infer<typeof TaggableEntityType>;

/**
 * Twelve WCAG-AA-compliant tag colours. Each value is a hex string the chip
 * uses as `background-color`. The chip's text colour is derived at runtime
 * from luminance so contrast always stays above 4.5:1.
 */
export const TAG_COLORS = [
  '#A78BFA', // violet-400 (default — matches BidStack brand)
  '#F472B6', // pink-400
  '#FB7185', // rose-400
  '#FB923C', // orange-400
  '#FBBF24', // amber-400
  '#A3E635', // lime-400
  '#34D399', // emerald-400
  '#22D3EE', // cyan-400
  '#60A5FA', // blue-400
  '#818CF8', // indigo-400
  '#94A3B8', // slate-400 (neutral)
  '#F87171', // red-400
] as const;
export type TagColor = (typeof TAG_COLORS)[number];

const colorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a 6-digit hex string');

export const TagName = z
  .string()
  .trim()
  .min(1, 'Tag name is required')
  .max(32, 'Tag name must be 32 characters or fewer');

export const Tag = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  name: z.string(),
  color: colorSchema,
  createdById: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  /** Convenience count populated by API responses; null if not queried. */
  usageCount: z.number().int().nonnegative().nullable().optional(),
});
export type Tag = z.infer<typeof Tag>;

export const TagCreate = z.object({
  name: TagName,
  color: colorSchema.default('#A78BFA'),
});
export type TagCreate = z.infer<typeof TagCreate>;

export const TagPatch = z.object({
  name: TagName.optional(),
  color: colorSchema.optional(),
});
export type TagPatch = z.infer<typeof TagPatch>;

export const TagList = z.object({
  items: z.array(Tag),
});
export type TagList = z.infer<typeof TagList>;

export const TagApply = z.object({
  entityType: TaggableEntityType,
  entityId: z.string().uuid(),
  tagIds: z.array(z.string().uuid()).min(1).max(20),
});
export type TagApply = z.infer<typeof TagApply>;

export const EntityTagsResponse = z.object({
  entityType: TaggableEntityType,
  entityId: z.string().uuid(),
  tags: z.array(Tag),
});
export type EntityTagsResponse = z.infer<typeof EntityTagsResponse>;

/**
 * AI-suggested tags. Returned by POST /v1/tags/suggest with a text payload.
 * Suggestions are never auto-applied; the UI surfaces them as one-click
 * chips next to a TagPicker.
 */
export const TagSuggestion = z.object({
  name: TagName,
  reason: z.string().max(280),
  confidence: z.number().min(0).max(1),
  existingTagId: z.string().uuid().nullable(),
});
export type TagSuggestion = z.infer<typeof TagSuggestion>;

export const TagSuggestRequest = z.object({
  entityType: TaggableEntityType,
  entityId: z.string().uuid(),
  /** Hint text for the suggester (e.g., the lead's description + intel). */
  text: z.string().min(1).max(8000),
});
export type TagSuggestRequest = z.infer<typeof TagSuggestRequest>;

export const TagSuggestResponse = z.object({
  suggestions: z.array(TagSuggestion).max(5),
});
export type TagSuggestResponse = z.infer<typeof TagSuggestResponse>;

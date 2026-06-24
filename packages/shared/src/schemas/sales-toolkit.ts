import { z } from 'zod';

/** Kind of sales collateral. */
export const SalesToolkitCategory = z.enum([
  'deck',
  'template',
  'battlecard',
  'casestudy',
  'playbook',
  'other',
]);
export type SalesToolkitCategory = z.infer<typeof SalesToolkitCategory>;

/** Where the toolkit came from. */
export const SalesToolkitSource = z.enum(['manual', 'sharepoint', 'lms']);
export type SalesToolkitSource = z.infer<typeof SalesToolkitSource>;

/** A stored sales toolkit asset (read shape). */
export const SalesToolkit = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  category: SalesToolkitCategory,
  sectorTags: z.array(z.string()),
  url: z.string().nullable(),
  source: SalesToolkitSource,
  externalId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SalesToolkit = z.infer<typeof SalesToolkit>;

/** Create payload (manual add). Source is server-set to 'manual'. */
export const SalesToolkitCreate = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(5000).nullable().optional(),
  category: SalesToolkitCategory.default('other'),
  sectorTags: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  url: z.string().url().max(2000).nullable().optional(),
});
export type SalesToolkitCreate = z.infer<typeof SalesToolkitCreate>;

/** Patch payload (partial). */
export const SalesToolkitPatch = SalesToolkitCreate.partial();
export type SalesToolkitPatch = z.infer<typeof SalesToolkitPatch>;

/** Paginated list. */
export const SalesToolkitList = z.object({
  items: z.array(SalesToolkit),
  nextCursor: z.string().nullable(),
});
export type SalesToolkitList = z.infer<typeof SalesToolkitList>;

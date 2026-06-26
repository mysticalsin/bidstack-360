import { z } from 'zod';

/**
 * SavedView — a named, org-scoped, per-user bookmark of a list page's
 * filter + sort + visible-column state. Unlike the older localStorage
 * `stores/savedViews` (which bookmarks a raw URL query string for Tasks
 * only), this is server-persisted and works on pages whose filters live in
 * component state (Accounts) as well as the URL (Opportunities, Leads).
 *
 * Why a generic `filters` record rather than a typed per-entity shape?
 * Each list page already owns its own filter vocabulary; the SavedView only
 * needs to round-trip it verbatim. The page supplies a `capture()` that
 * produces this record and an `apply()` that consumes it, so the server
 * stays page-agnostic and adding a view to a new page needs no schema change.
 */

export const SavedViewEntity = z.enum(['OPPORTUNITY', 'CONTACT', 'LEAD', 'COMPANY', 'TASK']);
export type SavedViewEntity = z.infer<typeof SavedViewEntity>;

// A filter spec is intentionally open: a flat record of primitive values the
// owning page knows how to interpret. Reject nested objects/arrays of objects
// to keep payloads small and serialisable (the page flattens before saving).
// Bounded like the rest of this schema (name/sort/columns are all capped): the
// value is persisted verbatim and doubled into auditLog.diff on PATCH, so these
// caps close an authenticated storage-amplification vector.
const FilterPrimitive = z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]);
export const SavedViewFilters = z
  .record(z.union([FilterPrimitive, z.array(FilterPrimitive).max(200)]))
  .refine((value) => Object.keys(value).length <= 50, {
    message: 'Too many filter keys (max 50)',
  });
export type SavedViewFilters = z.infer<typeof SavedViewFilters>;

export const SavedViewSort = z
  .object({
    field: z.string().min(1).max(80),
    direction: z.enum(['asc', 'desc']),
  })
  .nullable();
export type SavedViewSort = z.infer<typeof SavedViewSort>;

export const SavedViewColumns = z.array(z.string().min(1).max(80)).max(60).nullable();
export type SavedViewColumns = z.infer<typeof SavedViewColumns>;

export const SavedView = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
  entity: SavedViewEntity,
  name: z.string().min(1).max(120),
  filters: SavedViewFilters,
  sort: SavedViewSort,
  columns: SavedViewColumns,
  shared: z.boolean(),
  sortOrder: z.number().int(),
  /** True when the calling user owns this view (controls rename/delete in the UI). */
  isOwn: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SavedView = z.infer<typeof SavedView>;

export const SavedViewCreate = z.object({
  entity: SavedViewEntity,
  name: z.string().trim().min(1).max(120),
  filters: SavedViewFilters.default({}),
  sort: SavedViewSort.default(null),
  columns: SavedViewColumns.default(null),
  shared: z.boolean().default(false),
});
export type SavedViewCreate = z.infer<typeof SavedViewCreate>;

// Patch: rename and/or replace the captured state. `entity` is immutable — a
// view never changes which page it belongs to.
export const SavedViewPatch = z
  .object({
    name: z.string().trim().min(1).max(120),
    filters: SavedViewFilters,
    sort: SavedViewSort,
    columns: SavedViewColumns,
    shared: z.boolean(),
    sortOrder: z.number().int(),
  })
  .partial()
  .refine((p) => Object.keys(p).length > 0, { message: 'Empty patch' });
export type SavedViewPatch = z.infer<typeof SavedViewPatch>;

export const SavedViewListQuery = z.object({
  entity: SavedViewEntity.optional(),
});
export type SavedViewListQuery = z.infer<typeof SavedViewListQuery>;

export const SavedViewList = z.object({
  items: z.array(SavedView),
});
export type SavedViewList = z.infer<typeof SavedViewList>;

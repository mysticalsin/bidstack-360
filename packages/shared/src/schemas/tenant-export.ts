import { z } from 'zod';

// GDPR Article 20 (data portability) tenant export wire shapes.
//
// An org-admin requests an org-level export of all business/personal data; the
// API records a TenantExport row and a `tenant-export` worker produces a single
// gzipped NDJSON archive in durable storage. The raw storage key is NEVER put
// on the wire — only a short-lived signed download URL is exposed, and only
// once the export is `ready`.

/** Lifecycle states mirror the Prisma `TenantExportStatus` enum. */
export const TenantExportStatus = z.enum(['pending', 'running', 'ready', 'failed', 'expired']);
export type TenantExportStatus = z.infer<typeof TenantExportStatus>;

/**
 * A single export job as exposed to the requester. `downloadUrl` is a freshly
 * signed, short-lived URL — present only when status is `ready` and not past
 * `expiresAt`. `sizeBytes` is a string because the column is a BigInt and JS
 * Number cannot safely hold archive sizes above 2^53.
 */
export const TenantExportView = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  status: TenantExportStatus,
  requestedById: z.string().uuid(),
  sizeBytes: z.string().nullable(),
  downloadUrl: z.string().url().nullable(),
  expiresAt: z.string().datetime().nullable(),
  error: z.string().nullable(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type TenantExportView = z.infer<typeof TenantExportView>;

export const TenantExportListPage = z.object({
  items: z.array(TenantExportView),
  nextCursor: z.string().nullable(),
});
export type TenantExportListPage = z.infer<typeof TenantExportListPage>;

/** Cursor + limit for the list endpoint (keyset on createdAt-desc id). */
export const TenantExportListQuery = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type TenantExportListQuery = z.infer<typeof TenantExportListQuery>;

/** Path params for every /orgs/:orgId/export* route. */
export const TenantExportOrgParams = z.object({
  orgId: z.string().uuid(),
});
export type TenantExportOrgParams = z.infer<typeof TenantExportOrgParams>;

export const TenantExportIdParams = TenantExportOrgParams.extend({
  id: z.string().uuid(),
});
export type TenantExportIdParams = z.infer<typeof TenantExportIdParams>;

/** Job payload carried on the `tenant-export` queue. */
export const TenantExportJob = z.object({
  exportId: z.string().uuid(),
  orgId: z.string().uuid(),
});
export type TenantExportJob = z.infer<typeof TenantExportJob>;

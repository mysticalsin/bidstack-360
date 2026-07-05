// Tenant export routes — GDPR Article 20 (data portability).
//
// An org-admin requests an org-level export of all business / personal data.
// The route records a TenantExport row and enqueues a `tenant-export` job; the
// worker streams the data into a gzipped NDJSON archive in durable storage.
//
// Admin gate: `settings:write`, which in the canonical RBAC matrix is held only
// by the Admin role — so no new permission key (and no re-seed) is needed.
// Cross-tenant guard: :orgId MUST equal the caller's authenticated org.
// Single-flight: at most one pending|running export per org.

import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AuthContext } from '../plugins/auth.js';

import { prisma, type TenantExport } from '@bidstack/db';
import {
  TenantExportIdParams,
  TenantExportListPage,
  TenantExportListQuery,
  TenantExportOrgParams,
  TenantExportView,
} from '@bidstack/shared';

import { enqueueTenantExport } from '../queues/tenant-export.js';
import { getStorage } from '../storage/index.js';

export const tenantExportRoutes: FastifyPluginAsyncZod = async (server) => {
  // POST /orgs/:orgId/export — request a new export.
  server.post(
    '/orgs/:orgId/export',
    {
      config: { permission: 'settings:write', rateLimit: { max: 5, timeWindow: '1 minute' } },
      preHandler: server.requirePermission('settings:write'),
      schema: {
        params: TenantExportOrgParams,
        response: { 200: TenantExportView, 201: TenantExportView },
      },
    },
    async (req, reply) => {
      assertSameOrg(req);
      const orgId = req.auth.orgId;

      // Single-flight: if an export is already pending|running, return it (200)
      // instead of starting a second full-tenant scan.
      const inFlight = await prisma.tenantExport.findFirst({
        where: { orgId, status: { in: ['pending', 'running'] }, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      if (inFlight) {
        return reply.code(200).send(await toView(inFlight));
      }

      // Create the row + enqueue. The row is the durable source of truth; if the
      // enqueue fails (Redis down) the row stays `pending` for a retry to drive.
      const created = await prisma.tenantExport.create({
        data: { orgId, requestedById: req.auth.userId, status: 'pending' },
      });
      await enqueueTenantExport({ exportId: created.id, orgId });

      return reply.code(201).send(await toView(created));
    },
  );

  // GET /orgs/:orgId/exports — list this org's exports (keyset on createdAt-desc).
  server.get(
    '/orgs/:orgId/exports',
    {
      config: { permission: 'settings:write' },
      preHandler: server.requirePermission('settings:write'),
      schema: {
        params: TenantExportOrgParams,
        querystring: TenantExportListQuery,
        response: { 200: TenantExportListPage },
      },
    },
    async (req) => {
      assertSameOrg(req);
      const orgId = req.auth.orgId;
      const { cursor, limit } = req.query;

      const rows = await prisma.tenantExport.findMany({
        where: { orgId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      const hasMore = rows.length > limit;
      const items = await Promise.all(rows.slice(0, limit).map(toView));
      return {
        items,
        nextCursor: hasMore ? (rows[limit - 1]?.id ?? null) : null,
      };
    },
  );

  // GET /orgs/:orgId/exports/:id — single export status + fresh download URL.
  server.get(
    '/orgs/:orgId/exports/:id',
    {
      config: { permission: 'settings:write' },
      preHandler: server.requirePermission('settings:write'),
      schema: {
        params: TenantExportIdParams,
        response: { 200: TenantExportView },
      },
    },
    async (req) => {
      assertSameOrg(req);
      const row = await prisma.tenantExport.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
      });
      if (!row) throw req.server.httpErrors.notFound('Export not found');
      return toView(row);
    },
  );

  // GET /orgs/:orgId/exports/:id/download — authenticated streaming download for
  // the local storage driver (S3 uses the signed downloadUrl directly).
  server.get(
    '/orgs/:orgId/exports/:id/download',
    {
      config: { permission: 'settings:write' },
      preHandler: server.requirePermission('settings:write'),
      schema: { params: TenantExportIdParams },
    },
    async (req, reply) => {
      assertSameOrg(req);
      const row = await prisma.tenantExport.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
      });
      if (!row || !row.storageKey) throw req.server.httpErrors.notFound('Export not ready');
      if (row.status !== 'ready') throw req.server.httpErrors.conflict('Export is not ready');
      if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
        throw req.server.httpErrors.gone('Export download has expired');
      }
      // Defense in depth: never serve a key outside the caller's org namespace.
      if (!row.storageKey.startsWith(`orgs/${req.auth.orgId}/`)) {
        throw req.server.httpErrors.forbidden('Export key does not belong to this org');
      }
      return streamLocalArchive(req, reply, row.storageKey);
    },
  );
};

// ─── helpers ─────────────────────────────────────────────────────────────────

/** 403 unless the path :orgId matches the authenticated org (no cross-tenant). */
function assertSameOrg(req: { params: { orgId: string }; auth: AuthContext; server: FastifyRequest['server'] }): void {
  if (req.params.orgId !== req.auth.orgId) {
    throw req.server.httpErrors.forbidden('Cannot export another organization');
  }
}

/**
 * Map a TenantExport row to the wire view. For a `ready` export we mint a FRESH
 * short-lived download URL from the storage key (S3 = signed GET; local = the
 * authenticated streaming route). The raw storage key is never exposed.
 */
async function toView(row: TenantExport): Promise<TenantExportView> {
  const downloadUrl = await freshDownloadUrl(row);
  return {
    id: row.id,
    orgId: row.orgId,
    status: row.status,
    requestedById: row.requestedById,
    sizeBytes: row.sizeBytes != null ? row.sizeBytes.toString() : null,
    downloadUrl,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    error: row.error,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

async function freshDownloadUrl(row: TenantExport): Promise<string | null> {
  if (row.status !== 'ready' || !row.storageKey) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;

  const storage = await getStorage();
  if (storage.driver === 's3') {
    const result = await storage.getDownload(row.storageKey, {
      filename: `polo-presales-export-${row.id}.ndjson.gz`,
      contentType: 'application/gzip',
    });
    return result.url ?? null;
  }
  // Local: hand back the authenticated streaming route (no bearer URL in dev).
  const base = (process.env.PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
  return `${base}/api/v1/orgs/${row.orgId}/exports/${row.id}/download`;
}

/** Stream a local-driver archive straight back to the client. */
function streamLocalArchive(
  req: FastifyRequest,
  reply: FastifyReply,
  storageKey: string,
): FastifyReply {
  const root = resolveLocalUploadsRoot();
  const resolved = path.resolve(root, storageKey);
  if (!resolved.startsWith(root + path.sep) || !existsSync(resolved)) {
    throw req.server.httpErrors.notFound('Export file not found');
  }
  return reply
    .header('Content-Type', 'application/gzip')
    .header(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(storageKey))}`,
    )
    .header('Cache-Control', 'private, no-store')
    .send(createReadStream(resolved));
}

// Mirror resolveLocalUploadsRoot() in apps/api/src/storage/index.ts.
function resolveLocalUploadsRoot(): string {
  if (process.env.LOCAL_STORAGE_ROOT) return path.resolve(process.env.LOCAL_STORAGE_ROOT);
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      return path.join(dir, 'apps', 'api', '.uploads');
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(process.cwd(), '.uploads');
}

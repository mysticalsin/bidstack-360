/**
 * kam-prospections.ts — the prospection read-mirror of ABC.
 *
 * Prospections live in ABC (system of record). We do NOT rebuild tracking — this
 * mirror is populated by the ABC connector or a manual import (the floor) purely
 * to feed director-facing KPIs. orgId is stamped server-side; rows referencing a
 * cross-tenant company/owner are skipped (B3/m4). source='abc' rows dedup by the
 * ABC externalId; manual rows are UUID-keyed.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import {
  type KamProspectionDetail,
  KamProspectionImportBody,
  KamProspectionImportResult,
  KamProspectionList,
} from '@bidstack/shared';

import { assertCompanyVisible } from './kam-access.js';

export const kamProspectionRoutes: FastifyPluginAsyncZod = async (server) => {
  // ── Import / mirror sync ─────────────────────────────────────────────────
  server.post(
    '/kam/prospections/import',
    {
      preHandler: server.requirePermission('kam:write'),
      schema: { body: KamProspectionImportBody, response: { 200: KamProspectionImportResult } },
    },
    async (req) => {
      const { source, syncBatchId, rows } = req.body;
      const orgId = req.auth.orgId;
      // Resolve which referenced companies/owners are actually in this org.
      const companyIds = [...new Set(rows.map((r) => r.companyId).filter((x): x is string => !!x))];
      const ownerIds = [...new Set(rows.map((r) => r.ownerId).filter((x): x is string => !!x))];
      const [validCompanies, validOwners] = await Promise.all([
        companyIds.length
          ? prisma.company.findMany({ where: { id: { in: companyIds }, orgId, deletedAt: null }, select: { id: true }, take: 1000 })
          : Promise.resolve([]),
        ownerIds.length
          ? prisma.user.findMany({ where: { id: { in: ownerIds }, orgId, deletedAt: null }, select: { id: true }, take: 1000 })
          : Promise.resolve([]),
      ]);
      const okCompany = new Set(validCompanies.map((c) => c.id));
      const okOwner = new Set(validOwners.map((u) => u.id));

      let imported = 0;
      let skipped = 0;
      for (const row of rows) {
        // Skip rows that reference a cross-tenant company/owner (B3).
        if (row.companyId && !okCompany.has(row.companyId)) { skipped++; continue; }
        if (row.ownerId && !okOwner.has(row.ownerId)) { skipped++; continue; }
        if (source === 'abc' && !row.externalId) { skipped++; continue; } // ABC rows must carry the ABC id
        const base = {
          orgId,
          companyId: row.companyId ?? null,
          ownerId: row.ownerId ?? null,
          actionType: row.actionType,
          occurredAt: new Date(row.occurredAt),
          linkedTaskId: row.linkedTaskId ?? null,
          linkedInitiativeId: row.linkedInitiativeId ?? null,
          source,
          syncBatchId: syncBatchId ?? null,
          syncedAt: new Date(),
          deletedAt: null,
        };
        if (row.externalId) {
          const existing = await prisma.kamProspection.findFirst({
            where: { orgId, source, externalId: row.externalId },
            select: { id: true },
          });
          if (existing) {
            await prisma.kamProspection.update({ where: { id: existing.id }, data: base });
          } else {
            await prisma.kamProspection.create({ data: { ...base, externalId: row.externalId } });
          }
        } else {
          await prisma.kamProspection.create({ data: { ...base, externalId: null } });
        }
        imported++;
      }
      // Reconcile-on-absent (ABC removed a prospection) is a full-sync connector
      // concern; v1 manual import does not auto-delete. Tracked as a follow-up.
      return { imported, skipped, reconciledOut: 0 };
    },
  );

  // ── List (per-account) ─────────────────────────────────────────────────
  server.get(
    '/kam/prospections',
    {
      preHandler: server.requirePermission('kam:read'),
      schema: {
        querystring: z.object({ companyId: z.string().uuid() }),
        response: { 200: KamProspectionList },
      },
    },
    async (req) => {
      await assertCompanyVisible(server, req, req.query.companyId);
      const rows = await prisma.kamProspection.findMany({
        where: { orgId: req.auth.orgId, companyId: req.query.companyId, deletedAt: null },
        orderBy: [{ occurredAt: 'desc' }],
        take: 500,
      });
      return {
        items: rows.map((r) => ({
          id: r.id,
          companyId: r.companyId,
          ownerId: r.ownerId,
          externalId: r.externalId,
          actionType: r.actionType,
          occurredAt: r.occurredAt.toISOString(),
          source: r.source,
          syncedAt: r.syncedAt.toISOString(),
        })) satisfies z.infer<typeof KamProspectionDetail>[],
      };
    },
  );
};

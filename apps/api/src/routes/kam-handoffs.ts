/**
 * kam-handoffs.ts — export a KamHandoff to ABC's Opportunity-Management section.
 *
 * The handoff row is minted in the Initiative→opportunity transition. Here we
 * produce the structured ABC-OM payload (manual download now; future connector
 * later) and track status draft→exported→confirmed. Do NOT rebuild OM — this is
 * the clean interface boundary.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma, type Prisma } from '@bidstack/db';
import {
  KamHandoffConfirmBody,
  KamHandoffDetail,
  KamHandoffExportResult,
  KamHandoffList,
  type KamHandoffPayload,
} from '@bidstack/shared';

import { assertCompanyVisible } from './kam-access.js';

type HandoffRow = Prisma.KamHandoffGetPayload<Record<string, never>>;

function toHandoffDetail(row: HandoffRow): z.infer<typeof KamHandoffDetail> {
  return {
    id: row.id,
    companyId: row.companyId,
    initiativeId: row.initiativeId,
    opportunityId: row.opportunityId,
    status: row.status,
    targetSystem: row.targetSystem,
    externalRef: row.externalRef,
    exportedAt: row.exportedAt ? row.exportedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export const kamHandoffRoutes: FastifyPluginAsyncZod = async (server) => {
  async function loadHandoffOr404(
    req: Parameters<typeof assertCompanyVisible>[1],
    id: string,
  ): Promise<HandoffRow> {
    const handoff = await prisma.kamHandoff.findFirst({
      where: { id, orgId: req.auth.orgId, deletedAt: null },
    });
    if (!handoff) throw server.httpErrors.notFound('Handoff not found');
    await assertCompanyVisible(server, req, handoff.companyId);
    return handoff;
  }

  /** Build the ABC-OM payload from the canonical rows (all org-scoped). */
  async function buildPayload(
    orgId: string,
    handoff: HandoffRow,
    exportedAt: string,
  ): Promise<KamHandoffPayload> {
    const [company, initiative, opportunity] = await Promise.all([
      prisma.company.findFirst({
        where: { id: handoff.companyId, orgId },
        select: { id: true, name: true, countryCode: true },
      }),
      prisma.kamInitiative.findFirst({
        where: { id: handoff.initiativeId, orgId },
        select: { id: true, title: true, description: true, ownerId: true },
      }),
      handoff.opportunityId
        ? prisma.opportunity.findFirst({
            where: { id: handoff.opportunityId, orgId },
            select: { id: true, code: true, valueMicros: true },
          })
        : Promise.resolve(null),
    ]);
    if (!company || !initiative) {
      throw server.httpErrors.conflict('Handoff source rows are missing or deleted');
    }
    return {
      schemaVersion: 1,
      source: 'bidstack_kam',
      handoffId: handoff.id,
      exportedAt,
      account: { companyId: company.id, name: company.name, country: company.countryCode },
      initiative: {
        id: initiative.id,
        title: initiative.title,
        description: initiative.description,
        ownerId: initiative.ownerId,
      },
      opportunity: opportunity
        ? {
            id: opportunity.id,
            code: opportunity.code,
            valueMicros: Number(opportunity.valueMicros),
            currency: 'EUR',
          }
        : null,
    };
  }

  // ── List (per-account, optional status filter) ───────────────────────────
  server.get(
    '/kam/handoffs',
    {
      preHandler: server.requirePermission('kam:read'),
      schema: {
        querystring: z.object({
          companyId: z.string().uuid(),
          status: z.enum(['draft', 'exported', 'confirmed']).optional(),
        }),
        response: { 200: KamHandoffList },
      },
    },
    async (req) => {
      await assertCompanyVisible(server, req, req.query.companyId);
      const rows = await prisma.kamHandoff.findMany({
        where: {
          orgId: req.auth.orgId,
          companyId: req.query.companyId,
          deletedAt: null,
          ...(req.query.status ? { status: req.query.status } : {}),
        },
        orderBy: [{ createdAt: 'desc' }],
        take: 200,
      });
      return { items: rows.map(toHandoffDetail) };
    },
  );

  server.get(
    '/kam/handoffs/:id',
    {
      preHandler: server.requirePermission('kam:read'),
      schema: { params: z.object({ id: z.string().uuid() }), response: { 200: KamHandoffDetail } },
    },
    async (req) => toHandoffDetail(await loadHandoffOr404(req, req.params.id)),
  );

  // ── Export — produce the ABC-OM payload + mark exported (idempotent) ─────
  server.post(
    '/kam/handoffs/:id/export',
    {
      preHandler: server.requirePermission('kam:write'),
      schema: { params: z.object({ id: z.string().uuid() }), response: { 200: KamHandoffExportResult } },
    },
    async (req) => {
      const handoff = await loadHandoffOr404(req, req.params.id);
      if (handoff.status === 'confirmed') {
        throw server.httpErrors.conflict('Handoff already confirmed by OM');
      }
      const exportedAt = new Date();
      const payload = await buildPayload(req.auth.orgId, handoff, exportedAt.toISOString());
      const updated = await prisma.kamHandoff.update({
        where: { id: handoff.id },
        data: {
          status: 'exported',
          exportedAt,
          exportedById: req.auth.userId,
          exportPayload: payload as unknown as Prisma.InputJsonValue,
        },
      });
      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'kam_handoff.export',
          targetType: 'kam_handoff',
          targetId: handoff.id,
          diff: { opportunityId: handoff.opportunityId } as Prisma.InputJsonValue,
        },
      });
      return { handoff: toHandoffDetail(updated), payload };
    },
  );

  // ── Confirm — ABC OM acknowledged (record its id) ─────────────────────────
  server.post(
    '/kam/handoffs/:id/confirm',
    {
      preHandler: server.requirePermission('kam:write'),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: KamHandoffConfirmBody,
        response: { 200: KamHandoffDetail },
      },
    },
    async (req) => {
      const handoff = await loadHandoffOr404(req, req.params.id);
      if (handoff.status === 'draft') {
        throw server.httpErrors.conflict('Export the handoff before confirming');
      }
      const updated = await prisma.kamHandoff.update({
        where: { id: handoff.id },
        data: { status: 'confirmed', externalRef: req.body.externalRef },
      });
      return toHandoffDetail(updated);
    },
  );
};

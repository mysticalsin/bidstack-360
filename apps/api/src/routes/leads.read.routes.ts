/**
 * leads.read.routes.ts — GET /leads + GET /leads/:id.
 *
 * Extracted from leads.ts (BS-R1 file-size refactor).
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma, type LeadPriority, type LeadStatus } from '@bidstack/db';
import { LeadDetail, LeadFilter, LeadPage } from '@bidstack/shared';

export const leadRoutesRead: FastifyPluginAsyncZod = async (server) => {
  // ─── GET /api/leads ─────────────────────────────────────────────────────
  server.get(
    '/leads',
    {
      schema: {
        querystring: LeadFilter,
        response: { 200: LeadPage },
      },
    },
    async (req) => {
      const { status, priority, source, ownerId, search, cursor, limit } = req.query;
      const items = await prisma.lead.findMany({
        where: {
          orgId: req.auth.orgId,
          deletedAt: null,
          ...(status ? { status: status as LeadStatus } : {}),
          ...(priority ? { priority: priority as LeadPriority } : {}),
          ...(source ? { source } : {}),
          ...(ownerId ? { ownerId } : {}),
          ...(search
            ? {
                OR: [
                  { firstName: { contains: search, mode: 'insensitive' } },
                  { lastName: { contains: search, mode: 'insensitive' } },
                  { email: { contains: search, mode: 'insensitive' } },
                  { companyName: { contains: search, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        include: { owner: { select: { name: true } } },
        orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      const hasMore = items.length > limit;
      const page = hasMore ? items.slice(0, limit) : items;
      return {
        items: page.map((l) => ({
          id: l.id,
          firstName: l.firstName,
          lastName: l.lastName,
          email: l.email,
          phone: l.phone,
          companyName: l.companyName,
          title: l.title,
          source: l.source,
          status: l.status,
          score: l.score,
          priority: l.priority,
          ownerId: l.ownerId,
          ownerName: l.owner?.name ?? null,
          convertedToOpportunityId: l.convertedToOpportunityId,
          statusChangedAt: l.statusChangedAt.toISOString(),
          createdAt: l.createdAt.toISOString(),
          updatedAt: l.updatedAt.toISOString(),
        })),
        nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      };
    },
  );

  // ─── GET /api/leads/:id ──────────────────────────────────────────────────
  server.get(
    '/leads/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: LeadDetail },
      },
    },
    async (req) => {
      const lead = await prisma.lead.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        include: { owner: { select: { name: true } } },
      });
      if (!lead) throw server.httpErrors.notFound('Lead not found');
      const customFieldValues = await prisma.customFieldValue.findMany({
        where: { orgId: req.auth.orgId, entityType: 'lead', entityId: lead.id },
        select: { id: true, definitionId: true, value: true },
        take: 100,
      });
      return {
        id: lead.id,
        firstName: lead.firstName,
        lastName: lead.lastName,
        email: lead.email,
        phone: lead.phone,
        companyName: lead.companyName,
        title: lead.title,
        source: lead.source,
        status: lead.status,
        score: lead.score,
        priority: lead.priority,
        ownerId: lead.ownerId,
        ownerName: lead.owner?.name ?? null,
        convertedToOpportunityId: lead.convertedToOpportunityId,
        statusChangedAt: lead.statusChangedAt.toISOString(),
        createdAt: lead.createdAt.toISOString(),
        updatedAt: lead.updatedAt.toISOString(),
        notes: lead.notes,
        budget: lead.budget,
        authority: lead.authority,
        need: lead.need,
        timeline: lead.timeline,
        intel: lead.intel as Record<string, unknown> | null,
        customFieldValues,
      };
    },
  );
};

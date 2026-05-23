// Lead management routes — full CRUD + qualification + conversion.
// Conversion creates an Opportunity + Contact from a qualified lead.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  prisma,
  type Prisma,
  type OpportunityStage as PrismaStage,
  type LeadStatus,
  type LeadPriority,
} from '@bidstack/db';
import { pushLeadToDust } from '../lib/dust-push.js';
import {
  LeadCreate,
  LeadDetail,
  LeadFilter,
  LeadPage,
  LeadPatch,
  LeadConvertBody,
  LeadConvertResult,
} from '@bidstack/shared';

export const leadRoutes: FastifyPluginAsyncZod = async (server) => {
  // ─── GET /api/leads ───────────────────────────────────────────────────
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
          createdAt: l.createdAt.toISOString(),
          updatedAt: l.updatedAt.toISOString(),
        })),
        nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      };
    },
  );

  // ─── GET /api/leads/:id ───────────────────────────────────────────────
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
        createdAt: lead.createdAt.toISOString(),
        updatedAt: lead.updatedAt.toISOString(),
        notes: lead.notes,
        budget: lead.budget,
        authority: lead.authority,
        need: lead.need,
        timeline: lead.timeline,
        intel: lead.intel as Record<string, unknown> | null,
      };
    },
  );

  // ─── POST /api/leads ──────────────────────────────────────────────────
  server.post(
    '/leads',
    {
      schema: {
        body: LeadCreate,
        response: { 201: LeadDetail },
      },
    },
    async (req, reply) => {
      const body = req.body;
      const created = await prisma.$transaction(async (tx) => {
        const lead = await tx.lead.create({
          data: {
            orgId: req.auth.orgId,
            firstName: body.firstName,
            lastName: body.lastName,
            email: body.email ?? null,
            phone: body.phone ?? null,
            companyName: body.companyName,
            title: body.title ?? null,
            source: body.source,
            priority: body.priority,
            score: body.score,
            ownerId: body.ownerId ?? null,
            notes: body.notes ?? null,
            budget: body.budget ?? null,
            authority: body.authority ?? null,
            need: body.need ?? null,
            timeline: body.timeline ?? null,
          },
          include: { owner: { select: { name: true } } },
        });
        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'lead.create',
            targetType: 'lead',
            targetId: lead.id,
            diff: { source: body.source, companyName: body.companyName } as Prisma.InputJsonValue,
          },
        });
        return lead;
      });
      // Fire-and-forget push to Dust on create.
      void pushLeadToDust(created.id);

      return reply.code(201).send({
        id: created.id,
        firstName: created.firstName,
        lastName: created.lastName,
        email: created.email,
        phone: created.phone,
        companyName: created.companyName,
        title: created.title,
        source: created.source,
        status: created.status,
        score: created.score,
        priority: created.priority,
        ownerId: created.ownerId,
        ownerName: created.owner?.name ?? null,
        convertedToOpportunityId: created.convertedToOpportunityId,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
        notes: created.notes,
        budget: created.budget,
        authority: created.authority,
        need: created.need,
        timeline: created.timeline,
        intel: created.intel as Record<string, unknown> | null,
      });
    },
  );

  // ─── PATCH /api/leads/:id ─────────────────────────────────────────────
  server.patch(
    '/leads/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: LeadPatch,
        response: { 200: LeadDetail },
      },
    },
    async (req) => {
      const existing = await prisma.lead.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
      });
      if (!existing) throw server.httpErrors.notFound('Lead not found');

      const data: Prisma.LeadUpdateInput = {};
      const body = req.body;
      if (body.firstName !== undefined) data.firstName = body.firstName;
      if (body.lastName !== undefined) data.lastName = body.lastName;
      if (body.email !== undefined) data.email = body.email;
      if (body.phone !== undefined) data.phone = body.phone;
      if (body.companyName !== undefined) data.companyName = body.companyName;
      if (body.title !== undefined) data.title = body.title;
      if (body.source !== undefined) data.source = body.source;
      if (body.status !== undefined) data.status = body.status as LeadStatus;
      if (body.priority !== undefined) data.priority = body.priority as LeadPriority;
      if (body.score !== undefined) data.score = body.score;
      if (body.ownerId !== undefined)
        data.owner = body.ownerId ? { connect: { id: body.ownerId } } : { disconnect: true };
      if (body.notes !== undefined) data.notes = body.notes;
      if (body.budget !== undefined) data.budget = body.budget;
      if (body.authority !== undefined) data.authority = body.authority;
      if (body.need !== undefined) data.need = body.need;
      if (body.timeline !== undefined) data.timeline = body.timeline;

      const updated = await prisma.$transaction(async (tx) => {
        const updateResult = await tx.lead.updateMany({
          where: { id: existing.id, orgId: req.auth.orgId, deletedAt: null },
          data,
        });
        if (updateResult.count === 0) {
          throw server.httpErrors.notFound('Lead not found');
        }
        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'lead.update',
            targetType: 'lead',
            targetId: existing.id,
            diff: { fields: Object.keys(body) } as Prisma.InputJsonValue,
          },
        });
        return tx.lead.findFirstOrThrow({
          where: { id: existing.id, orgId: req.auth.orgId, deletedAt: null },
          include: { owner: { select: { name: true } } },
        });
      });
      // Fire-and-forget push to Dust on update.
      void pushLeadToDust(updated.id);

      return {
        id: updated.id,
        firstName: updated.firstName,
        lastName: updated.lastName,
        email: updated.email,
        phone: updated.phone,
        companyName: updated.companyName,
        title: updated.title,
        source: updated.source,
        status: updated.status,
        score: updated.score,
        priority: updated.priority,
        ownerId: updated.ownerId,
        ownerName: updated.owner?.name ?? null,
        convertedToOpportunityId: updated.convertedToOpportunityId,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
        notes: updated.notes,
        budget: updated.budget,
        authority: updated.authority,
        need: updated.need,
        timeline: updated.timeline,
        intel: updated.intel as Record<string, unknown> | null,
      };
    },
  );

  // ─── POST /api/leads/:id/convert ──────────────────────────────────────
  server.post(
    '/leads/:id/convert',
    {
      config: { rateLimit: { max: 15, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: LeadConvertBody,
        response: { 200: LeadConvertResult },
      },
    },
    async (req) => {
      const lead = await prisma.lead.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId },
      });
      if (!lead) throw server.httpErrors.notFound('Lead not found');
      if (lead.status === 'converted') {
        throw server.httpErrors.conflict('Lead already converted');
      }
      if (lead.status === 'disqualified') {
        throw server.httpErrors.conflict('Cannot convert a disqualified lead');
      }

      const body = req.body;
      const result = await prisma.$transaction(async (tx) => {
        // 1. Create Contact
        const contact = await tx.contact.create({
          data: {
            orgId: req.auth.orgId,
            customer: lead.companyName,
            name: `${lead.firstName} ${lead.lastName}`,
            role: lead.title,
            email: lead.email,
            phone: lead.phone,
          },
        });

        // 2. Create Opportunity
        const code = `OP-${Date.now().toString().slice(-4)}`;
        const opp = await tx.opportunity.create({
          data: {
            orgId: req.auth.orgId,
            code,
            customer: lead.companyName,
            name: body.opportunityName ?? `${lead.companyName} — ${lead.title ?? 'Opportunity'}`,
            stage: (body.stage ?? 's1_lead') as PrismaStage,
            valueMicros: BigInt(Math.round(body.opportunityValueMicros ?? 0)),
            probability: 20,
            ownerId: lead.ownerId,
          },
        });

        // 3. Mark lead as converted
        const updateResult = await tx.lead.updateMany({
          where: { id: lead.id, orgId: req.auth.orgId },
          data: {
            status: 'converted',
            convertedToOpportunityId: opp.id,
            convertedAt: new Date(),
          },
        });
        if (updateResult.count === 0) {
          throw new Error('Lead not found');
        }

        // 4. Audit log
        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'lead.convert',
            targetType: 'lead',
            targetId: lead.id,
            diff: { opportunityId: opp.id, contactId: contact.id } as Prisma.InputJsonValue,
          },
        });

        return { leadId: lead.id, opportunityId: opp.id, contactId: contact.id };
      });

      return result;
    },
  );

  // ─── DELETE /api/leads/:id ────────────────────────────────────────────
  server.delete(
    '/leads/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const existing = await prisma.lead.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
      });
      if (!existing) throw server.httpErrors.notFound('Lead not found');
      await prisma.$transaction(async (tx) => {
        const updateResult = await tx.lead.updateMany({
          where: { id: existing.id, orgId: req.auth.orgId, deletedAt: null },
          data: { deletedAt: new Date() },
        });
        if (updateResult.count === 0) {
          throw server.httpErrors.notFound('Lead not found');
        }
        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'lead.delete',
            targetType: 'lead',
            targetId: existing.id,
            diff: { name: `${existing.firstName} ${existing.lastName}` } as Prisma.InputJsonValue,
          },
        });
      });
      return reply.code(204).send(null);
    },
  );
};

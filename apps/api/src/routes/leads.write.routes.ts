/**
 * leads.write.routes.ts — POST /leads, PATCH /leads/:id,
 *                          POST /leads/:id/convert, DELETE /leads/:id.
 *
 * Extracted from leads.ts (BS-R1 file-size refactor).
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma, type Prisma, type LeadPriority, type LeadStatus } from '@bidstack/db';
import { pushLeadToDust } from '../lib/dust-push.js';
import { mintOpportunityTx, withOpportunityCodeRetry } from '../services/opportunities/mint.js';
import { fanOutWebhookEvent } from '../queues/webhook-delivery.js';
import { dispatchWorkflowEvent } from '../queues/workflow-dispatch.js';
import {
  LeadConvertBody,
  LeadConvertResult,
  LeadCreate,
  LeadDetail,
  LeadPatch,
} from '@bidstack/shared';

export const leadRoutesWrite: FastifyPluginAsyncZod = async (server) => {

  // RBAC: gate every route in this plugin. requirePermission throws 403 when the
  // caller's roles lack the key (no admin claim-fallback). Runs after the global
  // auth onRequest, so req.auth is populated.
  server.addHook('preHandler', server.requirePermission('leads:write'));
  // ─── POST /api/leads ─────────────────────────────────────────────────────
  server.post(
    '/leads',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        body: LeadCreate,
        response: { 201: LeadDetail },
      },
    },
    async (req, reply) => {
      const body = req.body;
      // Validate ownerId belongs to the caller's org before writing it — a lead
      // must never reference a user from another tenant.
      if (body.ownerId) {
        const owner = await prisma.user.findFirst({
          where: { id: body.ownerId, orgId: req.auth.orgId, deletedAt: null },
          select: { id: true },
        });
        if (!owner) throw server.httpErrors.badRequest('Owner must belong to your organization');
      }
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
      void pushLeadToDust(created.id, req.auth.orgId);
      // Fan-out webhook event to all active subscriptions — fire-and-forget.
      void fanOutWebhookEvent(req.auth.orgId, 'lead.created', {
        id: created.id,
        companyName: created.companyName,
        source: created.source,
        priority: created.priority,
      });
      // Dispatch record_created workflows for this lead (fail-open). `ownerId`
      // lets "notify the owner" actions resolve the recipient (the engine falls
      // back to input.ownerId when create_notification has no explicit userId).
      void dispatchWorkflowEvent(req.auth.orgId, 'record_created', 'lead', created.id, {
        source: created.source,
        priority: created.priority,
        ownerId: created.ownerId,
      });

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
        statusChangedAt: created.statusChangedAt.toISOString(),
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

  // ─── PATCH /api/leads/:id ────────────────────────────────────────────────
  server.patch(
    '/leads/:id',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
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

      const body = req.body;
      // A reassigned owner must belong to the caller's org (no cross-tenant connect).
      if (body.ownerId) {
        const owner = await prisma.user.findFirst({
          where: { id: body.ownerId, orgId: req.auth.orgId, deletedAt: null },
          select: { id: true },
        });
        if (!owner) throw server.httpErrors.badRequest('Owner must belong to your organization');
      }

      const data: Prisma.LeadUpdateInput = {};
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
        // CF upserts inside the transaction so a CF failure rolls back the
        // lead update — prevents partial-update / data corruption (P0 #5).
        if (body.customFieldValues !== undefined) {
          for (const { definitionId, value } of body.customFieldValues) {
            await tx.customFieldValue.upsert({
              where: {
                orgId_entityType_entityId_definitionId: {
                  orgId: req.auth.orgId,
                  entityType: 'lead',
                  entityId: existing.id,
                  definitionId,
                },
              },
              update: { value: value as Prisma.InputJsonValue },
              create: {
                orgId: req.auth.orgId,
                definitionId,
                entityType: 'lead',
                entityId: existing.id,
                value: value as Prisma.InputJsonValue,
              },
            });
          }
        }
        return tx.lead.findFirstOrThrow({
          where: { id: existing.id, orgId: req.auth.orgId, deletedAt: null },
          include: { owner: { select: { name: true } } },
        });
      });

      // Fire-and-forget push to Dust on update.
      void pushLeadToDust(updated.id, req.auth.orgId);

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
        statusChangedAt: updated.statusChangedAt.toISOString(),
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

  // ─── POST /api/leads/:id/convert ─────────────────────────────────────────
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
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
      });
      if (!lead) throw server.httpErrors.notFound('Lead not found');
      if (lead.status === 'converted') {
        throw server.httpErrors.conflict('Lead already converted');
      }
      if (lead.status === 'disqualified') {
        throw server.httpErrors.conflict('Cannot convert a disqualified lead');
      }

      const body = req.body;
      // Bounded retry on (orgId, code) collisions — mintNextCode reads inside
      // the transaction, so a concurrent convert/create can race it; the whole
      // transaction (contact + opportunity + lead flip) rolls back and re-runs.
      const runConvert = () =>
        prisma.$transaction(async (tx) => {
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

        // 2. Create Opportunity via the shared mint primitive (code mint +
        //    stage resolution). companyId stays unset here, preserving the
        //    legacy lead-convert behavior. See services/opportunities/mint.ts.
        const opp = await mintOpportunityTx(tx, {
          orgId: req.auth.orgId,
          customer: lead.companyName,
          name: body.opportunityName ?? `${lead.companyName} — ${lead.title ?? 'Opportunity'}`,
          valueMicros: BigInt(Math.round(body.opportunityValueMicros ?? 0)),
          ownerId: lead.ownerId,
          pipelineStageId: body.pipelineStageId,
          stageKey: body.stage,
        });

        // 3. Mark lead as converted. The status guard makes this flip the
        // concurrency gate: two simultaneous converts both pass the outside-tx
        // check, but only one updateMany matches `status != converted`. The
        // loser's count===0 throws a 409, aborting its $transaction so the
        // duplicate contact + opportunity it created above are rolled back.
        const updateResult = await tx.lead.updateMany({
          where: { id: lead.id, orgId: req.auth.orgId, status: { not: 'converted' } },
          data: {
            status: 'converted',
            convertedToOpportunityId: opp.id,
            convertedAt: new Date(),
          },
        });
        if (updateResult.count === 0) {
          throw server.httpErrors.conflict('Lead already converted');
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

      return withOpportunityCodeRetry(runConvert);
    },
  );

  // ─── DELETE /api/leads/:id ───────────────────────────────────────────────
  server.delete(
    '/leads/:id',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
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
            diff: {
              name: `${existing.firstName} ${existing.lastName}`,
            } as Prisma.InputJsonValue,
          },
        });
      });
      return reply.code(204).send(null);
    },
  );
};

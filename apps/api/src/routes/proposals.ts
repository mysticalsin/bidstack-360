import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@bidstack/db';
import {
  Proposal,
  ProposalCreate,
  ProposalPatch,
  ProposalFilter,
  ProposalPage,
  ProposalSectionPatch,
  ProposalDraftRequest,
  ProposalDraftResponse,
} from '@bidstack/shared';
import { MemOSService } from '@bidstack/memos';
import { draftProposalSection } from '../services/ai/dust-agent.service.js';
import { tenantEntityBelongsToOrg } from '../lib/tenant-ownership.js';
import { canViewAllRfps } from '../lib/rfp-visibility.js';
import { fanOutWebhookEvent } from '../queues/webhook-delivery.js';

import { DEFAULT_SECTIONS, serializeProposal } from './proposals.helpers.js';

// DEFAULT_SECTIONS and serializeProposal extracted to ./proposals.helpers.ts (BS-R1)

export const proposalRoutes: FastifyPluginAsyncZod = async (server) => {
  const memos = new MemOSService();

  // GET /api/proposals
  server.get(
    '/proposals',
    {
      schema: {
        querystring: ProposalFilter,
        response: { 200: ProposalPage },
      },
    },
    async (req) => {
      const { status, opportunityId, search, limit, offset } = req.query;
      const where = {
        orgId: req.auth.orgId,
        deletedAt: null,
        // RFP visibility: non-admins see only the proposals they own; admins see all.
        ...(canViewAllRfps(req) ? {} : { ownerId: req.auth.userId }),
        ...(status ? { status } : {}),
        ...(opportunityId ? { opportunityId } : {}),
        ...(search
          ? {
              OR: [{ name: { contains: search, mode: 'insensitive' as const } }],
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        prisma.proposal.findMany({
          where,
          orderBy: { updatedAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.proposal.count({ where }),
      ]);
      return { items: items.map(serializeProposal), total };
    },
  );

  // GET /api/proposals/:id
  server.get(
    '/proposals/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: Proposal },
      },
    },
    async (req, reply) => {
      const row = await prisma.proposal.findFirst({
        where: {
          orgId: req.auth.orgId,
          id: req.params.id,
          deletedAt: null,
          // RFP visibility: a non-admin may only access proposals they own.
          ...(canViewAllRfps(req) ? {} : { ownerId: req.auth.userId }),
        },
        include: { sections: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } } },
      });
      if (!row) return reply.notFound('Proposal not found');
      return {
        ...serializeProposal(row),
        sections: row.sections.map((s) => ({
          id: s.id,
          proposalId: s.proposalId,
          key: s.key as z.infer<typeof ProposalDraftRequest>['sectionKey'],
          title: s.title,
          content: s.content,
          wordCount: s.wordCount,
          aiDrafted: s.aiDrafted,
          sortOrder: s.sortOrder,
          required: s.required,
          createdAt: s.createdAt.toISOString(),
          updatedAt: s.updatedAt.toISOString(),
        })),
      };
    },
  );

  // POST /api/proposals
  server.post(
    '/proposals',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        body: ProposalCreate,
        response: { 201: Proposal },
      },
    },
    async (req, reply) => {
      const { opportunityId, name, dueDate } = req.body;
      if (
        opportunityId &&
        !(await tenantEntityBelongsToOrg('opportunity', opportunityId, req.auth.orgId))
      ) {
        return reply.notFound('Opportunity not found');
      }

      const row = await prisma.proposal.create({
        data: {
          orgId: req.auth.orgId,
          opportunityId: opportunityId ?? null,
          name,
          dueDate: dueDate ? new Date(dueDate) : null,
          ownerId: req.auth.userId,
          sections: {
            create: DEFAULT_SECTIONS.map((s) => ({
              orgId: req.auth.orgId,
              key: s.key,
              title: s.title,
              sortOrder: s.sortOrder,
              required: s.required,
            })),
          },
        },
        include: { sections: true },
      });
      reply.status(201);
      return {
        ...serializeProposal(row),
        sections: row.sections.map((s) => ({
          id: s.id,
          proposalId: s.proposalId,
          key: s.key as z.infer<typeof ProposalDraftRequest>['sectionKey'],
          title: s.title,
          content: s.content,
          wordCount: s.wordCount,
          aiDrafted: s.aiDrafted,
          sortOrder: s.sortOrder,
          required: s.required,
          createdAt: s.createdAt.toISOString(),
          updatedAt: s.updatedAt.toISOString(),
        })),
      };
    },
  );

  // PATCH /api/proposals/:id
  server.patch(
    '/proposals/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: ProposalPatch,
        response: { 200: Proposal },
      },
    },
    async (req, reply) => {
      const row = await prisma.proposal.findFirst({
        where: {
          orgId: req.auth.orgId,
          id: req.params.id,
          deletedAt: null,
          // RFP visibility: a non-admin may only access proposals they own.
          ...(canViewAllRfps(req) ? {} : { ownerId: req.auth.userId }),
        },
      });
      if (!row) return reply.notFound('Proposal not found');

      const updated = await prisma.proposal.update({
        where: { id: req.params.id },
        data: {
          ...(req.body.name !== undefined ? { name: req.body.name } : {}),
          ...(req.body.status !== undefined ? { status: req.body.status } : {}),
          ...(req.body.dueDate !== undefined
            ? { dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null }
            : {}),
        },
      });
      // Fan-out proposal.submitted when status transitions to submitted — fire-and-forget.
      if (req.body.status === 'submitted' && updated.status === 'submitted') {
        void fanOutWebhookEvent(req.auth.orgId, 'proposal.submitted', {
          id: updated.id,
          name: updated.name,
          opportunityId: updated.opportunityId,
        });
      }

      // L2 MemOS win/loss crystallization — fires only on a genuine status
      // transition to won/lost (idempotent: row.status !== req.body.status).
      // Fire-and-forget: a MemOS failure must not block the PATCH response.
      // WHY L2 (not L1): win/loss outcomes are policy-level insights that
      // influence future proposal drafts via getPoliciesForScope(); L1 is for
      // raw run traces, L2 is for derived strategic signals.
      if (
        (req.body.status === 'won' || req.body.status === 'lost') &&
        row.status !== req.body.status
      ) {
        void memos
          .crystallizePolicy({
            orgId: req.auth.orgId,
            key: `proposal:${req.params.id}:outcome`,
            category: 'win_loss',
            scopeType: 'opportunity',
            scopeId: updated.opportunityId ?? undefined,
            insight: `Proposal "${updated.name}" was marked ${req.body.status}.`,
            confidence: 0.9,
            evidence: {
              proposalId: req.params.id,
              outcome: req.body.status,
              previousStatus: row.status,
            },
          })
          .catch((err: unknown) => {
            server.log.warn(
              { err, proposalId: req.params.id },
              'MemOS L2 win/loss crystallization failed — non-critical',
            );
          });
      }

      return serializeProposal(updated);
    },
  );

  // PATCH /api/proposals/:id/sections/:sectionId
  server.patch(
    '/proposals/:id/sections/:sectionId',
    {
      schema: {
        params: z.object({ id: z.string().uuid(), sectionId: z.string().uuid() }),
        body: ProposalSectionPatch,
        response: { 200: z.object({ id: z.string().uuid(), wordCount: z.number().int() }) },
      },
    },
    async (req, reply) => {
      const proposal = await prisma.proposal.findFirst({
        where: {
          orgId: req.auth.orgId,
          id: req.params.id,
          deletedAt: null,
          // RFP visibility: a non-admin may only access proposals they own.
          ...(canViewAllRfps(req) ? {} : { ownerId: req.auth.userId }),
        },
      });
      if (!proposal) return reply.notFound('Proposal not found');

      const section = await prisma.proposalSection.findFirst({
        where: {
          orgId: req.auth.orgId,
          id: req.params.sectionId,
          proposalId: req.params.id,
          deletedAt: null,
        },
      });
      if (!section) return reply.notFound('Section not found');

      const content = req.body.content ?? section.content;
      const wordCount = content.trim().split(/\s+/).filter(Boolean).length;

      const updated = await prisma.proposalSection.update({
        where: { id: req.params.sectionId },
        data: {
          ...(req.body.title !== undefined ? { title: req.body.title } : {}),
          ...(req.body.content !== undefined ? { content, wordCount } : {}),
        },
      });
      return { id: updated.id, wordCount: updated.wordCount };
    },
  );

  // POST /api/proposals/:id/draft
  server.post(
    '/proposals/:id/draft',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: ProposalDraftRequest,
        response: { 200: ProposalDraftResponse },
      },
    },
    async (req, reply) => {
      const proposal = await prisma.proposal.findFirst({
        where: {
          orgId: req.auth.orgId,
          id: req.params.id,
          deletedAt: null,
          // RFP visibility: a non-admin may only access proposals they own.
          ...(canViewAllRfps(req) ? {} : { ownerId: req.auth.userId }),
        },
        include: { sections: true, opportunity: { include: { company: true, territory: true } } },
      });
      if (!proposal) return reply.notFound('Proposal not found');

      const section = proposal.sections.find((s) => s.key === req.body.sectionKey);
      if (!section) return reply.notFound('Section not found');

      const opp = proposal.opportunity;
      const customer = opp?.company?.name ?? 'Unknown';

      // Build opportunity context
      const opportunityContext = [
        opp ? `Opportunity: ${opp.name}` : '',
        opp ? `Stage: ${opp.stage}, Probability: ${opp.probability}%` : '',
        opp?.valueMicros ? `Value: €${(Number(opp.valueMicros) / 1e6).toLocaleString()}` : '',
        opp?.territory?.name ? `Territory: ${opp.territory.name}` : '',
        req.body.context ? `User context: ${req.body.context}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      // Build MemOS context
      const policies = await memos.getPoliciesForScope(
        req.auth.orgId,
        'opportunity',
        proposal.opportunityId ?? undefined,
        undefined,
        10,
      );
      const worldModels = await memos.retrieveContext('', {
        orgId: req.auth.orgId,
        tier: 'l3',
        domain: 'proposal_patterns',
        limit: 5,
      });

      const memosContext = [
        `Historical policies:`,
        ...policies.map((p) => `- ${p.key}: ${p.insight} (confidence: ${p.confidence})`),
        `World models:`,
        ...worldModels.map((m) => `- ${m.key}: ${JSON.stringify(m.value)}`),
      ].join('\n');

      const draft = await draftProposalSection({
        sectionKey: section.key,
        sectionTitle: section.title,
        proposalName: proposal.name,
        customer,
        opportunityContext,
        memosContext,
        existingContent: section.content ?? '',
      });

      const wordCount = draft.content.trim().split(/\s+/).filter(Boolean).length;

      await prisma.proposalSection.update({
        where: { id: section.id },
        data: { content: draft.content, wordCount, aiDrafted: true },
      });

      return {
        sectionKey: req.body.sectionKey,
        content: draft.content,
        wordCount,
        sources: draft.sources,
      };
    },
  );

  // DELETE /api/proposals/:id
  server.delete(
    '/proposals/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const row = await prisma.proposal.findFirst({
        where: {
          orgId: req.auth.orgId,
          id: req.params.id,
          deletedAt: null,
          // RFP visibility: a non-admin may only access proposals they own.
          ...(canViewAllRfps(req) ? {} : { ownerId: req.auth.userId }),
        },
      });
      if (!row) return reply.notFound('Proposal not found');
      await prisma.proposal.update({
        where: { id: req.params.id },
        data: { deletedAt: new Date() },
      });
      reply.status(204);
      return null;
    },
  );
};

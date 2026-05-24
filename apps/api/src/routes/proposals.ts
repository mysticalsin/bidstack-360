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
  type ProposalStatus,
} from '@bidstack/shared';
import { MemOSService } from '@bidstack/memos';
import { draftProposalSection } from '../services/ai/dust-agent.service.js';
import { tenantEntityBelongsToOrg } from '../lib/tenant-ownership.js';
import { fanOutWebhookEvent } from '../queues/webhook-delivery.js';

const DEFAULT_SECTIONS = [
  { key: 'executive_summary', title: 'Executive Summary', sortOrder: 0, required: true },
  { key: 'technical_approach', title: 'Technical Approach', sortOrder: 1, required: true },
  { key: 'pricing', title: 'Pricing & Commercial Terms', sortOrder: 2, required: true },
  { key: 'case_studies', title: 'Case Studies & References', sortOrder: 3, required: false },
  { key: 'team_bios', title: 'Team Bios', sortOrder: 4, required: false },
  { key: 'risk_matrix', title: 'Risk Matrix & Mitigation', sortOrder: 5, required: true },
] as const;

function serializeProposal(row: {
  id: string;
  orgId: string;
  opportunityId: string | null;
  name: string;
  status: string;
  version: number;
  ownerId: string | null;
  complianceScore: number | null;
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): z.infer<typeof Proposal> {
  return {
    id: row.id,
    orgId: row.orgId,
    opportunityId: row.opportunityId,
    name: row.name,
    status: row.status as z.infer<typeof ProposalStatus>,
    version: row.version,
    ownerId: row.ownerId,
    complianceScore: row.complianceScore,
    dueDate: row.dueDate?.toISOString().split('T')[0] ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

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
        ...(status ? { status } : {}),
        ...(opportunityId ? { opportunityId } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        prisma.proposal.findMany({ where, orderBy: { updatedAt: 'desc' }, take: limit, skip: offset }),
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
        where: { orgId: req.auth.orgId, id: req.params.id, deletedAt: null },
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
        where: { orgId: req.auth.orgId, id: req.params.id, deletedAt: null },
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
        where: { orgId: req.auth.orgId, id: req.params.id, deletedAt: null },
      });
      if (!proposal) return reply.notFound('Proposal not found');

      const section = await prisma.proposalSection.findFirst({
        where: { orgId: req.auth.orgId, id: req.params.sectionId, proposalId: req.params.id, deletedAt: null },
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
        where: { orgId: req.auth.orgId, id: req.params.id, deletedAt: null },
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
      ].filter(Boolean).join('\n');

      // Build MemOS context
      const policies = await memos.getPoliciesForScope(req.auth.orgId, 'opportunity', proposal.opportunityId ?? undefined, undefined, 10);
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

      return { sectionKey: req.body.sectionKey, content: draft.content, wordCount, sources: draft.sources };
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
        where: { orgId: req.auth.orgId, id: req.params.id, deletedAt: null },
      });
      if (!row) return reply.notFound('Proposal not found');
      await prisma.proposal.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
      reply.status(204);
      return null;
    },
  );
};

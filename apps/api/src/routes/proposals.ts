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

import {
  immutableProposalMessage,
  proposalApprovalRoutes,
  proposalIsImmutable,
} from './proposals.approval.js';
import { DEFAULT_SECTIONS, serializeProposal } from './proposals.helpers.js';

// DEFAULT_SECTIONS and serializeProposal extracted to ./proposals.helpers.ts (BS-R1)

export const proposalRoutes: FastifyPluginAsyncZod = async (server) => {
  const memos = new MemOSService();
  await server.register(proposalApprovalRoutes);

  // GET /api/proposals
  server.get(
    '/proposals',
    {
      config: { permission: 'proposals:read' },
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
      config: { permission: 'proposals:read' },
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

  // GET /api/proposals/admin/analytics — admin-only org-wide RFP rollup.
  // WHY a dedicated admin endpoint: regular users are owner-scoped (see
  // canViewAllRfps), so they can't roll up the org. Admins get the cross-owner
  // view the requirement calls for — counts, pipeline value (from each
  // proposal's linked opportunity), and a per-owner breakdown.
  // WHY requireRole('admin') (not requirePermission): mirrors the other admin
  // analytics endpoints (monitoring.ts) and the frontend's useIsAdmin gate.
  const AdminAnalytics = z.object({
    totalCount: z.number().int(),
    wonCount: z.number().int(),
    lostCount: z.number().int(),
    // Money stays in micros on the wire (formatted at the edge); BigInt is
    // serialised as a string so it survives JSON without precision loss.
    totalValueMicros: z.string(),
    byStatus: z.array(z.object({ status: z.string(), count: z.number().int() })),
    byOwner: z.array(
      z.object({
        ownerId: z.string().nullable(),
        ownerName: z.string(),
        count: z.number().int(),
        totalValueMicros: z.string(),
      }),
    ),
  });

  server.get(
    '/proposals/admin/analytics',
    {
      preHandler: server.requireRole('admin'),
      schema: { response: { 200: AdminAnalytics } },
    },
    async (req) => {
      const orgId = req.auth.orgId;
      // Aggregate in SQL: COUNT + SUM(linked opportunity value) grouped by status
      // and owner in one pass. A grouped $queryRaw (not a findMany) bypasses the dev
      // query-guard's row cap and stays correct at any org size. Parameterized +
      // org-scoped; status cast to text and the bigint sum to text for safe transport.
      const rows = await prisma.$queryRaw<
        Array<{ status: string; owner_id: string | null; cnt: number; val: string }>
      >`
        SELECT p.status::text AS status,
               p.owner_id      AS owner_id,
               COUNT(*)::int   AS cnt,
               COALESCE(SUM(o.value_micros), 0)::text AS val
        FROM proposals p
        LEFT JOIN opportunities o ON o.id = p.opportunity_id AND o.org_id = p.org_id
        WHERE p.org_id = ${orgId}::uuid AND p.deleted_at IS NULL
        GROUP BY p.status, p.owner_id
      `;

      const statusCounts = new Map<string, number>();
      const ownerAgg = new Map<string, { count: number; value: bigint }>();
      let totalValue = BigInt(0);
      let totalCount = 0;
      for (const r of rows) {
        const cnt = Number(r.cnt);
        const val = BigInt(r.val);
        totalCount += cnt;
        totalValue += val;
        statusCounts.set(r.status, (statusCounts.get(r.status) ?? 0) + cnt);
        const key = r.owner_id ?? '';
        const cur = ownerAgg.get(key) ?? { count: 0, value: BigInt(0) };
        cur.count += cnt;
        cur.value += val;
        ownerAgg.set(key, cur);
      }

      const ownerIds = [...ownerAgg.keys()].filter((k) => k.length > 0);
      const users = ownerIds.length
        ? await prisma.user.findMany({
            where: { id: { in: ownerIds }, orgId, deletedAt: null },
            select: { id: true, name: true, email: true },
            take: ownerIds.length, // bounded to the distinct owners we just collected
          })
        : [];
      const nameById = new Map(users.map((u) => [u.id, u.name ?? u.email]));

      return {
        totalCount,
        wonCount: statusCounts.get('won') ?? 0,
        lostCount: statusCounts.get('lost') ?? 0,
        totalValueMicros: totalValue.toString(),
        byStatus: [...statusCounts.entries()].map(([status, count]) => ({ status, count })),
        byOwner: [...ownerAgg.entries()]
          .map(([ownerId, agg]) => ({
            ownerId: ownerId || null,
            ownerName: ownerId ? (nameById.get(ownerId) ?? 'Unknown') : 'Unassigned',
            count: agg.count,
            totalValueMicros: agg.value.toString(),
          }))
          .sort((a, b) => b.count - a.count),
      };
    },
  );

  // POST /api/proposals
  server.post(
    '/proposals',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      preHandler: [server.requirePermission('proposals:write')],
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
      preHandler: [server.requirePermission('proposals:write')],
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

      const substantive =
        req.body.name !== undefined ||
        req.body.status !== undefined ||
        req.body.dueDate !== undefined;
      if (proposalIsImmutable(row.status) && substantive) {
        throw server.httpErrors.conflict(immutableProposalMessage());
      }

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

      return serializeProposal(updated);
    },
  );

  // PATCH /api/proposals/:id/sections/:sectionId
  server.patch(
    '/proposals/:id/sections/:sectionId',
    {
      preHandler: [server.requirePermission('proposals:write')],
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
      if (
        proposalIsImmutable(proposal.status) &&
        (req.body.title !== undefined || req.body.content !== undefined)
      ) {
        throw server.httpErrors.conflict(immutableProposalMessage());
      }

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
      preHandler: [server.requirePermission('proposals:write')],
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
      if (proposalIsImmutable(proposal.status)) {
        throw server.httpErrors.conflict(immutableProposalMessage());
      }

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
        orgId: req.auth.orgId,
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
      preHandler: [server.requirePermission('proposals:write')],
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

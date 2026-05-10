// Opportunity routes per handoff/openapi.yaml.
// All queries scoped by req.auth.orgId.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma, OpportunityStage as PrismaStage } from '@bidstack/db';
import {
  Opportunity,
  OpportunityCreate,
  OpportunityFilter,
  OpportunityPage,
  OpportunityPatch,
  OpportunityStage,
} from '@bidstack/shared';

import { serializeOpportunity, serializeOpportunityFull } from '../serializers/opportunity.js';

export const opportunityRoutes: FastifyPluginAsyncZod = async (server) => {
  // GET /api/opportunities
  server.get(
    '/opportunities',
    {
      schema: {
        querystring: OpportunityFilter,
        response: { 200: OpportunityPage },
      },
    },
    async (req) => {
      const { stage, owner, industry, search, cursor, limit } = req.query;
      const items = await prisma.opportunity.findMany({
        where: {
          orgId: req.auth.orgId,
          ...(stage ? { stage: stage as PrismaStage } : {}),
          ...(industry ? { industry } : {}),
          ...(owner ? { owner: { email: owner } } : {}),
          ...(search
            ? {
                OR: [
                  { customer: { contains: search, mode: 'insensitive' } },
                  { name: { contains: search, mode: 'insensitive' } },
                  { code: { contains: search, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        include: { owner: true },
        orderBy: { updatedAt: 'desc' },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      const hasMore = items.length > limit;
      const page = hasMore ? items.slice(0, limit) : items;
      return {
        items: page.map(serializeOpportunity),
        nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      };
    },
  );

  // POST /api/opportunities
  server.post(
    '/opportunities',
    {
      schema: {
        body: OpportunityCreate,
        response: { 201: Opportunity },
      },
    },
    async (req, reply) => {
      const body = req.body;
      // Mint a code if the caller didn't supply one
      const code = body.code ?? (await mintNextCode(req.auth.orgId));

      const created = await prisma.opportunity.create({
        data: {
          orgId: req.auth.orgId,
          code,
          customer: body.customer,
          name: body.name,
          stage: body.stage as PrismaStage,
          valueEur: body.value,
          probability: body.probability,
          dueDate: body.dueDate ? new Date(body.dueDate) : null,
          industry: body.industry,
          logoUrl: body.logo,
          intel: {},
        },
        include: { owner: true },
      });
      return reply.code(201).send(serializeOpportunity(created));
    },
  );

  // GET /api/opportunities/:id  (full 360° payload)
  server.get(
    '/opportunities/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
      },
    },
    async (req) => {
      const opp = await prisma.opportunity.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId },
        include: {
          owner: true,
          tasks: { orderBy: { createdAt: 'desc' }, take: 50 },
          documents: { orderBy: { createdAt: 'desc' }, take: 50 },
        },
      });
      if (!opp) throw server.httpErrors.notFound('Opportunity not found');
      return serializeOpportunityFull(opp);
    },
  );

  // PATCH /api/opportunities/:id
  server.patch(
    '/opportunities/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: OpportunityPatch,
        response: { 200: Opportunity },
      },
    },
    async (req) => {
      const before = await prisma.opportunity.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId },
      });
      if (!before) throw server.httpErrors.notFound('Opportunity not found');

      const updated = await prisma.opportunity.update({
        where: { id: before.id },
        data: {
          ...(req.body.customer ? { customer: req.body.customer } : {}),
          ...(req.body.name ? { name: req.body.name } : {}),
          ...(req.body.stage ? { stage: req.body.stage as PrismaStage } : {}),
          ...(req.body.value !== undefined ? { valueEur: req.body.value } : {}),
          ...(req.body.probability !== undefined ? { probability: req.body.probability } : {}),
          ...(req.body.dueDate !== undefined
            ? { dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null }
            : {}),
          ...(req.body.industry !== undefined ? { industry: req.body.industry } : {}),
          ...(req.body.logo !== undefined ? { logoUrl: req.body.logo } : {}),
        },
        include: { owner: true },
      });

      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'opportunity.update',
          targetType: 'opportunity',
          targetId: updated.id,
          diff: req.body as object,
        },
      });

      return serializeOpportunity(updated);
    },
  );

  // POST /api/opportunities/:id/stage  (kanban move)
  server.post(
    '/opportunities/:id/stage',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ stage: OpportunityStage }),
        response: {
          200: z.object({ id: z.string().uuid(), stage: OpportunityStage }),
        },
      },
    },
    async (req) => {
      const opp = await prisma.opportunity.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId },
      });
      if (!opp) throw server.httpErrors.notFound('Opportunity not found');

      const updated = await prisma.opportunity.update({
        where: { id: opp.id },
        data: { stage: req.body.stage as PrismaStage },
      });
      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'opportunity.stage',
          targetType: 'opportunity',
          targetId: opp.id,
          diff: { from: opp.stage, to: req.body.stage },
        },
      });
      return { id: updated.id, stage: updated.stage as z.infer<typeof OpportunityStage> };
    },
  );

  // POST /api/opportunities/:id/brief
  // Stubbed: returns a deterministic markdown brief in dev.
  // Production will call Dust agent then Anthropic fallback per openapi.yaml.
  server.post(
    '/opportunities/:id/brief',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: z.object({
            brief: z.string(),
            model: z.string(),
            tokens: z.number().int(),
          }),
        },
      },
    },
    async (req) => {
      const opp = await prisma.opportunity.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId },
      });
      if (!opp) throw server.httpErrors.notFound('Opportunity not found');

      const brief = `# Exec brief — ${opp.customer}

**Opportunity:** ${opp.name} (${opp.code})
**Stage:** ${opp.stage}  ·  **Value:** €${opp.valueEur.toString()}  ·  **Probability:** ${opp.probability}%

> Stub brief generated locally. Set \`DUST_API_KEY\` and \`DUST_AGENT_EXEC_BRIEF\` to enable the live agent path.
`;
      return { brief, model: 'stub-local', tokens: brief.length };
    },
  );
};

async function mintNextCode(orgId: string): Promise<string> {
  const last = await prisma.opportunity.findFirst({
    where: { orgId, code: { startsWith: 'OP-' } },
    orderBy: { code: 'desc' },
    select: { code: true },
  });
  if (!last) return 'OP-2001';
  const n = Number(last.code.slice(3));
  return `OP-${(n + 1).toString().padStart(4, '0')}`;
}

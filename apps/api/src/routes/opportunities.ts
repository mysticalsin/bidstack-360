// Opportunity routes per handoff/openapi.yaml.
// All queries scoped by req.auth.orgId.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma, Prisma, type OpportunityStage as PrismaStage } from '@bidstack/db';
import { pushOpportunityToDust } from '../lib/dust-push.js';
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

  // GET /api/opportunities/count — lightweight count for badges / KPIs
  server.get(
    '/opportunities/count',
    {
      schema: {
        querystring: z.object({
          stage: z.string().optional(),
          excludeClosed: z.coerce.boolean().optional(),
        }),
        response: { 200: z.object({ count: z.number().int() }) },
      },
    },
    async (req) => {
      const { stage, excludeClosed } = req.query;
      const count = await prisma.opportunity.count({
        where: {
          orgId: req.auth.orgId,
          ...(stage ? { stage: stage as PrismaStage } : {}),
          ...(excludeClosed
            ? { stage: { notIn: ['closed_won', 'closed_lost'] as PrismaStage[] } }
            : {}),
        },
      });
      return { count };
    },
  );

  // POST /api/opportunities
  server.post(
    '/opportunities',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        body: OpportunityCreate,
        response: { 201: Opportunity },
      },
    },
    async (req, reply) => {
      const body = req.body;
      // Mint code + create + audit atomically; retry on Q-NNNN unique
      // collision with bounded attempts (mirrors sales-orders pattern).
      let createdId: string | null = null;
      for (let attempt = 0; attempt < 5 && !createdId; attempt += 1) {
        try {
          createdId = await prisma.$transaction(async (tx) => {
            const code = body.code ?? (await mintNextCode(tx, req.auth.orgId));
            const created = await tx.opportunity.create({
              data: {
                orgId: req.auth.orgId,
                code,
                customer: body.customer,
                name: body.name,
                stage: body.stage as PrismaStage,
                valueMicros: BigInt(Math.round(body.value * 1_000_000)),
                probability: body.probability,
                dueDate: body.dueDate ? new Date(body.dueDate) : null,
                industry: body.industry,
                logoUrl: body.logo,
                intel: {},
              },
            });
            await tx.auditLog.create({
              data: {
                orgId: req.auth.orgId,
                userId: req.auth.userId,
                action: 'opportunity.create',
                targetType: 'opportunity',
                targetId: created.id,
                diff: { code, customer: body.customer, name: body.name, stage: body.stage },
              },
            });
            return created.id;
          });
        } catch (err) {
          if (isUniqueViolation(err) && attempt < 4) continue;
          throw err;
        }
      }
      if (!createdId) {
        throw server.httpErrors.conflict('Could not allocate a unique opportunity code; retry.');
      }
      // Re-fetch with `orgId` in the filter for defence-in-depth — the id was
      // minted inside our tx so it's safe, but every other read in this file
      // is org-scoped and we don't want to break that invariant.
      const created = await prisma.opportunity.findFirstOrThrow({
        where: { id: createdId, orgId: req.auth.orgId },
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

      // Update + audit atomic so a crash mid-mutation can't leave an opp
      // changed without a paper trail (Arch-4).
      const [updated] = await prisma.$transaction([
        prisma.opportunity.update({
          where: { id: before.id },
          data: {
            ...(req.body.customer ? { customer: req.body.customer } : {}),
            ...(req.body.name ? { name: req.body.name } : {}),
            ...(req.body.stage ? { stage: req.body.stage as PrismaStage } : {}),
            ...(req.body.value !== undefined
              ? { valueMicros: BigInt(Math.round(req.body.value * 1_000_000)) }
              : {}),
            ...(req.body.probability !== undefined ? { probability: req.body.probability } : {}),
            ...(req.body.dueDate !== undefined
              ? { dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null }
              : {}),
            ...(req.body.industry !== undefined ? { industry: req.body.industry } : {}),
            ...(req.body.logo !== undefined ? { logoUrl: req.body.logo } : {}),
          },
          include: { owner: true },
        }),
        prisma.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'opportunity.update',
            targetType: 'opportunity',
            targetId: before.id,
            diff: req.body as object,
          },
        }),
      ]);

      // Fire-and-forget push to Dust on any field update.
      void pushOpportunityToDust(updated.id);

      return serializeOpportunity(updated);
    },
  );

  // DELETE /api/opportunities/:id  (audit P-H5: bulk delete in OpportunitiesPage
  // was hitting this missing route and silently 404'ing every row.)
  server.delete(
    '/opportunities/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const opp = await prisma.opportunity.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId },
        select: { id: true, code: true, customer: true, name: true, stage: true },
      });
      if (!opp) throw server.httpErrors.notFound('Opportunity not found');

      // Tombstone in audit log first, then delete. Wrap in $transaction so
      // either both land or neither does — never delete-without-record.
      // Cascading FKs on Task / Document delete with the parent (Prisma onDelete: Cascade).
      await prisma.$transaction([
        prisma.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'opportunity.delete',
            targetType: 'opportunity',
            targetId: opp.id,
            diff: {
              code: opp.code,
              customer: opp.customer,
              name: opp.name,
              stage: opp.stage,
            },
          },
        }),
        prisma.opportunity.delete({ where: { id: opp.id } }),
      ]);

      return reply.code(204).send(null);
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

      const [updated] = await prisma.$transaction([
        prisma.opportunity.update({
          where: { id: opp.id },
          data: { stage: req.body.stage as PrismaStage },
        }),
        prisma.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'opportunity.stage',
            targetType: 'opportunity',
            targetId: opp.id,
            diff: { from: opp.stage, to: req.body.stage },
          },
        }),
      ]);
      // Fire-and-forget push to Dust on stage change.
      void pushOpportunityToDust(updated.id);
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
**Stage:** ${opp.stage}  ·  **Value:** €${(Number(opp.valueMicros) / 1_000_000).toString()}  ·  **Probability:** ${opp.probability}%

> Stub brief generated locally. Set \`DUST_API_KEY\` and \`DUST_AGENT_EXEC_BRIEF\` to enable the live agent path.
`;
      return { brief, model: 'stub-local', tokens: brief.length };
    },
  );
};

async function mintNextCode(tx: Prisma.TransactionClient, orgId: string): Promise<string> {
  // Reads inside the active transaction so a concurrent create's row is
  // visible to whichever attempt wins. Unique violation on collision is
  // caught by the caller's bounded retry loop.
  const last = await tx.opportunity.findFirst({
    where: { orgId, code: { startsWith: 'OP-' } },
    orderBy: { code: 'desc' },
    select: { code: true },
  });
  if (!last) return 'OP-2001';
  const n = Number(last.code.slice(3));
  return `OP-${(n + 1).toString().padStart(4, '0')}`;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

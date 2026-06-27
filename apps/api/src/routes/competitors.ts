// Competitor Intelligence — HTTP endpoints.
//
//   GET  /competitors                          — list the org's competitor profiles
//   POST /competitors                          — create a profile
//   POST /competitors/:competitorId/research   — trigger a grounded research run
//   GET  /competitors/:competitorId/insights   — list this competitor's cited insights
//   GET  /opportunities/:opportunityId/competitor-insights — insights for a bid
//
// Every insight is grounded: it always carries a sourceUrl (the DB enforces NOT
// NULL). Research itself runs in the worker (competitor.research queue).

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Prisma, prisma } from '@bidstack/db';
import { normalizeName } from '@bidstack/shared';
import { createLogger } from '../lib/logger.js';
import { enqueueCompetitorResearch } from '../queues/competitor-research.js';

const log = createLogger({ name: 'competitors' });

const ProfileResponse = z.object({
  id: z.string().uuid(),
  name: z.string(),
  domain: z.string().nullable(),
  aliases: z.array(z.string()),
  createdAt: z.string(),
});

const InsightResponse = z.object({
  id: z.string().uuid(),
  competitorProfileId: z.string().uuid(),
  opportunityId: z.string().uuid().nullable(),
  category: z.string(),
  status: z.string(),
  title: z.string(),
  summary: z.string(),
  sourceUrl: z.string(),
  sourceTitle: z.string().nullable(),
  provider: z.string(),
  confidenceBps: z.number().int(),
  publishedAt: z.string().nullable(),
  retrievedAt: z.string(),
});

export const competitorRoutes: FastifyPluginAsyncZod = async (server) => {
  // ── List competitor profiles ──────────────────────────────────────────────
  server.get(
    '/competitors',
    {
      config: { permission: 'opportunities:read' },
      preHandler: server.requirePermission('opportunities:read'),
      schema: { response: { 200: z.object({ items: z.array(ProfileResponse) }) } },
    },
    async (req) => {
      const { orgId } = req.auth;
      const rows = await prisma.competitorProfile.findMany({
        where: { orgId, deletedAt: null },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, domain: true, aliases: true, createdAt: true },
        // Bounded to satisfy the unbounded-query guard; competitor profiles are
        // org-curated and low-volume, so a high cap lists them all without risk.
        take: 500,
      });
      return { items: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) };
    },
  );

  // ── Create a competitor profile ───────────────────────────────────────────
  server.post(
    '/competitors',
    {
      config: { permission: 'opportunities:write' },
      preHandler: server.requirePermission('opportunities:write'),
      schema: {
        body: z.object({
          name: z.string().trim().min(1).max(200),
          domain: z.string().trim().max(255).optional(),
          aliases: z.array(z.string().trim().min(1)).max(20).optional(),
        }),
        response: { 201: ProfileResponse },
      },
    },
    async (req, reply) => {
      const { orgId, userId } = req.auth;
      const normalized = normalizeName(req.body.name);
      if (!normalized) throw server.httpErrors.badRequest('Competitor name is required');
      try {
        const created = await prisma.competitorProfile.create({
          data: {
            orgId,
            name: req.body.name.trim(),
            normalizedName: normalized,
            domain: req.body.domain?.trim() || null,
            aliases: req.body.aliases ?? [],
            createdByUserId: userId,
          },
          select: { id: true, name: true, domain: true, aliases: true, createdAt: true },
        });
        reply.status(201);
        return { ...created, createdAt: created.createdAt.toISOString() };
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw server.httpErrors.conflict('A competitor with this name already exists');
        }
        throw err;
      }
    },
  );

  // ── Trigger a grounded research run ───────────────────────────────────────
  server.post(
    '/competitors/:competitorId/research',
    {
      config: { permission: 'opportunities:write' },
      preHandler: server.requirePermission('opportunities:write'),
      schema: {
        params: z.object({ competitorId: z.string().uuid() }),
        body: z.object({
          opportunityId: z.string().uuid().optional(),
          seedUrls: z.array(z.string().url()).max(20).optional(),
        }),
        response: { 202: z.object({ jobId: z.string().nullable(), status: z.literal('queued') }) },
      },
    },
    async (req, reply) => {
      const { orgId } = req.auth;
      const profile = await prisma.competitorProfile.findFirst({
        where: { id: req.params.competitorId, orgId, deletedAt: null },
        select: { id: true },
      });
      if (!profile) throw server.httpErrors.notFound('Competitor not found');

      // Verify the opportunity belongs to this org before scoping research to it.
      if (req.body.opportunityId) {
        const opp = await prisma.opportunity.findFirst({
          where: { id: req.body.opportunityId, orgId, deletedAt: null },
          select: { id: true },
        });
        if (!opp) throw server.httpErrors.notFound('Opportunity not found');
      }

      const jobId = await enqueueCompetitorResearch({
        orgId,
        competitorProfileId: profile.id,
        opportunityId: req.body.opportunityId ?? null,
        seedUrls: req.body.seedUrls,
      });
      log.info({ orgId, competitorProfileId: profile.id, jobId }, 'competitor research queued');
      reply.status(202);
      return { jobId, status: 'queued' as const };
    },
  );

  // ── List a competitor's insights ──────────────────────────────────────────
  server.get(
    '/competitors/:competitorId/insights',
    {
      config: { permission: 'opportunities:read' },
      preHandler: server.requirePermission('opportunities:read'),
      schema: {
        params: z.object({ competitorId: z.string().uuid() }),
        querystring: z.object({ opportunityId: z.string().uuid().optional() }),
        response: { 200: z.object({ items: z.array(InsightResponse) }) },
      },
    },
    async (req) => {
      const { orgId } = req.auth;
      const items = await prisma.competitorInsight.findMany({
        where: {
          orgId,
          competitorProfileId: req.params.competitorId,
          opportunityId: req.query.opportunityId ?? undefined,
          status: 'active',
          deletedAt: null,
        },
        orderBy: [{ confidenceBps: 'desc' }, { retrievedAt: 'desc' }],
        take: 200,
        select: {
          id: true,
          competitorProfileId: true,
          opportunityId: true,
          category: true,
          status: true,
          title: true,
          summary: true,
          sourceUrl: true,
          sourceTitle: true,
          provider: true,
          confidenceBps: true,
          publishedAt: true,
          retrievedAt: true,
        },
      });
      return {
        items: items.map((i) => ({
          ...i,
          publishedAt: i.publishedAt?.toISOString() ?? null,
          retrievedAt: i.retrievedAt.toISOString(),
        })),
      };
    },
  );

  // ── Insights for an opportunity (feeds the bid-workspace panel) ───────────
  server.get(
    '/opportunities/:opportunityId/competitor-insights',
    {
      config: { permission: 'opportunities:read' },
      preHandler: server.requirePermission('opportunities:read'),
      schema: {
        params: z.object({ opportunityId: z.string().uuid() }),
        response: { 200: z.object({ items: z.array(InsightResponse) }) },
      },
    },
    async (req) => {
      const { orgId } = req.auth;
      const items = await prisma.competitorInsight.findMany({
        where: {
          orgId,
          opportunityId: req.params.opportunityId,
          status: 'active',
          deletedAt: null,
        },
        orderBy: [{ confidenceBps: 'desc' }, { retrievedAt: 'desc' }],
        take: 200,
        select: {
          id: true,
          competitorProfileId: true,
          opportunityId: true,
          category: true,
          status: true,
          title: true,
          summary: true,
          sourceUrl: true,
          sourceTitle: true,
          provider: true,
          confidenceBps: true,
          publishedAt: true,
          retrievedAt: true,
        },
      });
      return {
        items: items.map((i) => ({
          ...i,
          publishedAt: i.publishedAt?.toISOString() ?? null,
          retrievedAt: i.retrievedAt.toISOString(),
        })),
      };
    },
  );
};

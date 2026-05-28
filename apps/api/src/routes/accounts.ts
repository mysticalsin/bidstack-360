// Key Accounts & Top Accounts routes.
// Key accounts are manually flagged (tier = 'key').
// Top accounts are auto-ranked by total revenue/pipeline.

import type { FastifyPluginAsync } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma, type Prisma } from '@bidstack/db';

const KeyAccountResponse = z.object({
  id: z.string().uuid(),
  name: z.string(),
  domain: z.string().nullable(),
  industry: z.string().nullable(),
  logoUrl: z.string().nullable(),
  tier: z.string().nullable(),
  keyAccountSince: z.string().nullable(),
  keyAccountOwnerId: z.string().nullable(),
  keyAccountNotes: z.string().nullable(),
  totalValue: z.number(),
  openDeals: z.number(),
  contactCount: z.number(),
  opportunityCount: z.number(),
});

const TopAccountResponse = KeyAccountResponse.extend({
  topAccountRank: z.number(),
  wonValue: z.number(),
});

export const accountsRoutes: FastifyPluginAsync = async (server) => {
  const app = server.withTypeProvider<ZodTypeProvider>();

  // GET /api/v1/accounts/key — list key accounts
  app.get('/accounts/key', {
    schema: {
      querystring: z.object({
        search: z.string().max(200).optional(),
        industry: z.string().max(100).optional(),
        ownerId: z.string().uuid().optional(),
      }),
      response: { 200: z.object({ items: z.array(KeyAccountResponse) }) },
    },
    handler: async (req, reply) => {
      const { orgId } = req.auth;
      const { search, industry, ownerId } = req.query;

      const companies = await prisma.company.findMany({
        where: {
          orgId,
          tier: 'key',
          deletedAt: null,
          ...(search
            ? {
                OR: [
                  { name: { contains: search, mode: 'insensitive' } },
                  { domain: { contains: search, mode: 'insensitive' } },
                ],
              }
            : {}),
          ...(industry ? { industry: { equals: industry, mode: 'insensitive' } } : {}),
          ...(ownerId ? { keyAccountOwnerId: ownerId } : {}),
        },
        orderBy: { name: 'asc' },
        take: 1000,
      });

      const companyIds = companies.map((c) => c.id);

      const [opps, contacts] = await Promise.all([
        prisma.opportunity.findMany({
          where: { orgId, companyId: { in: companyIds }, deletedAt: null },
          select: { companyId: true, valueMicros: true, stage: true },
          take: 1000,
        }),
        prisma.contact.groupBy({
          by: ['companyId'],
          where: { orgId, companyId: { in: companyIds }, deletedAt: null },
          _count: { id: true },
        }),
      ]);

      const contactMap = new Map(contacts.map((c) => [c.companyId, c._count.id]));
      const oppMap = new Map<string, { totalValue: number; openDeals: number; count: number }>();

      for (const o of opps) {
        if (!o.companyId) continue;
        const existing = oppMap.get(o.companyId) ?? { totalValue: 0, openDeals: 0, count: 0 };
        existing.totalValue += Number(o.valueMicros) / 1_000_000;
        existing.count += 1;
        if (o.stage !== 'closed_won' && o.stage !== 'closed_lost') {
          existing.openDeals += 1;
        }
        oppMap.set(o.companyId, existing);
      }

      const enriched = companies.map((c) => {
        const o = oppMap.get(c.id) ?? { totalValue: 0, openDeals: 0, count: 0 };
        return {
          id: c.id,
          name: c.name,
          domain: c.domain,
          industry: c.industry,
          logoUrl: c.logoUrl,
          tier: c.tier,
          keyAccountSince: c.keyAccountSince?.toISOString() ?? null,
          keyAccountOwnerId: c.keyAccountOwnerId,
          keyAccountNotes: c.keyAccountNotes,
          totalValue: o.totalValue,
          openDeals: o.openDeals,
          contactCount: contactMap.get(c.id) ?? 0,
          opportunityCount: o.count,
        };
      });

      return reply.send({ items: enriched });
    },
  });

  // GET /api/v1/accounts/top — list top N accounts by revenue
  app.get('/accounts/top', {
    schema: {
      querystring: z.object({
        limit: z.coerce.number().int().min(1).max(100).default(20),
        search: z.string().max(200).optional(),
        industry: z.string().max(100).optional(),
      }),
      response: { 200: z.object({ items: z.array(TopAccountResponse) }) },
    },
    handler: async (req, reply) => {
      const { orgId } = req.auth;
      const { limit, search, industry } = req.query;

      const companies = await prisma.company.findMany({
        where: {
          orgId,
          deletedAt: null,
          ...(search
            ? {
                OR: [
                  { name: { contains: search, mode: 'insensitive' } },
                  { domain: { contains: search, mode: 'insensitive' } },
                ],
              }
            : {}),
          ...(industry ? { industry: { equals: industry, mode: 'insensitive' } } : {}),
        },
        take: 1000,
      });

      const companyIds = companies.map((c) => c.id);

      const [opps, contacts] = await Promise.all([
        prisma.opportunity.findMany({
          where: { orgId, companyId: { in: companyIds }, deletedAt: null },
          select: { companyId: true, valueMicros: true, stage: true },
          take: 1000,
        }),
        prisma.contact.groupBy({
          by: ['companyId'],
          where: { orgId, companyId: { in: companyIds }, deletedAt: null },
          _count: { id: true },
        }),
      ]);

      const contactMap = new Map(contacts.map((c) => [c.companyId, c._count.id]));
      const oppMap = new Map<
        string,
        { totalValue: number; wonValue: number; openDeals: number; count: number }
      >();

      for (const o of opps) {
        if (!o.companyId) continue;
        const existing = oppMap.get(o.companyId) ?? {
          totalValue: 0,
          wonValue: 0,
          openDeals: 0,
          count: 0,
        };
        existing.totalValue += Number(o.valueMicros) / 1_000_000;
        existing.count += 1;
        if (o.stage === 'closed_won') {
          existing.wonValue += Number(o.valueMicros) / 1_000_000;
        }
        if (o.stage !== 'closed_won' && o.stage !== 'closed_lost') {
          existing.openDeals += 1;
        }
        oppMap.set(o.companyId, existing);
      }

      const ranked = companies
        .map((c) => {
          const o = oppMap.get(c.id) ?? { totalValue: 0, wonValue: 0, openDeals: 0, count: 0 };
          return {
            id: c.id,
            name: c.name,
            domain: c.domain,
            industry: c.industry,
            logoUrl: c.logoUrl,
            tier: c.tier,
            keyAccountSince: c.keyAccountSince?.toISOString() ?? null,
            keyAccountOwnerId: c.keyAccountOwnerId,
            keyAccountNotes: c.keyAccountNotes,
            topAccountRank: c.topAccountRank,
            totalValue: o.totalValue,
            wonValue: o.wonValue,
            openDeals: o.openDeals,
            contactCount: contactMap.get(c.id) ?? 0,
            opportunityCount: o.count,
          };
        })
        .sort((a, b) => b.totalValue - a.totalValue)
        .slice(0, limit);

      const rankedWithRank = ranked.map((c, index) => ({ ...c, topAccountRank: index + 1 }));

      return reply.send({ items: rankedWithRank });
    },
  });

  // PATCH /api/v1/companies/:id/tier — update account tier
  app.patch('/companies/:id/tier', {
    preHandler: server.requirePermission('accounts:write'),
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        tier: z.enum(['key', 'top', 'standard']),
        keyAccountOwnerId: z.string().uuid().optional(),
        keyAccountNotes: z.string().max(2000).optional(),
      }),
      response: {
        200: z.object({
          id: z.string().uuid(),
          name: z.string(),
          tier: z.string().nullable(),
          keyAccountSince: z.string().nullable(),
          keyAccountOwnerId: z.string().nullable(),
          keyAccountNotes: z.string().nullable(),
        }),
      },
    },
    handler: async (req, reply) => {
      const { orgId } = req.auth;
      const { id } = req.params;
      const { tier, keyAccountOwnerId, keyAccountNotes } = req.body;

      const company = await prisma.company.findFirst({
        where: { id, orgId, deletedAt: null },
      });
      if (!company) {
        throw server.httpErrors.notFound('Company not found');
      }

      if (keyAccountOwnerId) {
        const owner = await prisma.user.findFirst({
          where: { id: keyAccountOwnerId, orgId },
          select: { id: true },
        });
        if (!owner) {
          throw server.httpErrors.badRequest('Key account owner must belong to your organization');
        }
      }

      const updateData: Prisma.CompanyUpdateManyMutationInput = {
        tier,
        keyAccountOwnerId: keyAccountOwnerId ?? null,
        keyAccountNotes: keyAccountNotes ?? null,
      };

      if (tier === 'key' && company.tier !== 'key') {
        updateData.keyAccountSince = new Date();
      } else if (tier !== 'key') {
        updateData.keyAccountSince = null;
      }

      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.company.updateMany({
          where: { id, orgId, deletedAt: null },
          data: updateData,
        });
        if (result.count !== 1) {
          throw server.httpErrors.notFound('Company not found');
        }
        await tx.auditLog.create({
          data: {
            orgId,
            userId: req.auth.userId,
            action: 'company.tier.update',
            targetType: 'company',
            targetId: id,
            diff: { tier, keyAccountOwnerId: keyAccountOwnerId ?? null },
          },
        });
        return tx.company.findFirstOrThrow({ where: { id, orgId, deletedAt: null } });
      });

      return reply.send({
        id: updated.id,
        name: updated.name,
        tier: updated.tier,
        keyAccountSince: updated.keyAccountSince?.toISOString() ?? null,
        keyAccountOwnerId: updated.keyAccountOwnerId,
        keyAccountNotes: updated.keyAccountNotes,
      });
    },
  });

  // GET /api/v1/accounts/industries — distinct industries for filter dropdown
  app.get('/accounts/industries', {
    schema: {
      response: { 200: z.object({ items: z.array(z.string()) }) },
    },
    handler: async (req, reply) => {
      const { orgId } = req.auth;
      const rows = await prisma.company.findMany({
        where: { orgId, deletedAt: null },
        select: { industry: true },
        distinct: ['industry'],
        take: 1000,
      });
      const industries = rows
        .map((r) => r.industry)
        .filter((industry): industry is string => Boolean(industry))
        .sort();
      return reply.send({ items: industries });
    },
  });
};

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

  // GET /api/v1/accounts/key — list key accounts (cursor-paginated)
  app.get('/accounts/key', {
    schema: {
      querystring: z.object({
        search: z.string().max(200).optional(),
        industry: z.string().max(100).optional(),
        ownerId: z.string().uuid().optional(),
        // WHY cursor pagination: the previous take:1000 ceiling silently dropped
        // key accounts past position 1,000 and loaded the full set on every
        // request even when the caller only needed a screenful. Cursor + limit
        // bounds both problems.
        limit: z.coerce.number().int().min(1).max(200).default(50),
        cursor: z.string().uuid().optional(),
      }),
      response: {
        200: z.object({
          items: z.array(KeyAccountResponse),
          nextCursor: z.string().uuid().nullable(),
        }),
      },
    },
    handler: async (req, reply) => {
      const { orgId } = req.auth;
      const { search, industry, ownerId, limit, cursor } = req.query;

      const where = {
        orgId,
        tier: 'key' as const,
        deletedAt: null,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' as const } },
                { domain: { contains: search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
        ...(industry ? { industry: { equals: industry, mode: 'insensitive' as const } } : {}),
        ...(ownerId ? { keyAccountOwnerId: ownerId } : {}),
      };

      // Fetch one extra row to detect whether a next page exists.
      const companies = await prisma.company.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      const hasMore = companies.length > limit;
      const page = hasMore ? companies.slice(0, limit) : companies;
      const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;

      const companyIds = page.map((c) => c.id);

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

      const items = page.map((c) => {
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

      return reply.send({ items, nextCursor });
    },
  });

  // GET /api/v1/accounts/top — list top N accounts by total opportunity value
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

      // WHY raw SQL: the previous implementation loaded all companies (take:1000)
      // and their opportunities (take:1000) into JS, then sorted and sliced.
      // For orgs with >1,000 companies this silently missed high-value accounts
      // beyond position 1,000, and always loaded the full company+opp set even
      // when limit=5. A single GROUP BY query pushes all aggregation to Postgres
      // and returns exactly `limit` rows regardless of org size.
      //
      // Conditional filters are expressed as (${param}::text IS NULL OR ...)
      // so Prisma can parameterize all values safely without dynamic SQL.
      const searchPat = search ? `%${search}%` : null;
      const industryVal = industry ?? null;

      type TopRow = {
        id: string;
        name: string;
        domain: string | null;
        industry: string | null;
        logoUrl: string | null;
        tier: string | null;
        keyAccountSince: Date | null;
        keyAccountOwnerId: string | null;
        keyAccountNotes: string | null;
        topAccountRank: number | null;
        totalValue: number;
        wonValue: number;
        openDeals: bigint; // Postgres COUNT → BigInt
        opportunityCount: bigint;
      };

      const rows = await prisma.$queryRaw<TopRow[]>`
        SELECT
          c.id,
          c.name,
          c.domain,
          c.industry,
          c.logo_url             AS "logoUrl",
          c.tier::text           AS "tier",
          c.key_account_since    AS "keyAccountSince",
          c.key_account_owner_id AS "keyAccountOwnerId",
          c.key_account_notes    AS "keyAccountNotes",
          c.top_account_rank     AS "topAccountRank",
          COALESCE(SUM(o.value_micros), 0)::float8 / 1000000.0 AS "totalValue",
          COALESCE(SUM(CASE WHEN o.stage = 'closed_won'::opportunity_stage
                            THEN o.value_micros ELSE 0 END), 0)::float8 / 1000000.0
                                                                         AS "wonValue",
          COUNT(CASE WHEN o.stage NOT IN ('closed_won'::opportunity_stage,
                                          'closed_lost'::opportunity_stage)
                     THEN 1 ELSE NULL END)                               AS "openDeals",
          COUNT(o.id)                                                    AS "opportunityCount"
        FROM companies c
        LEFT JOIN opportunities o
          ON  o.company_id = c.id
          AND o.org_id     = ${orgId}::uuid
          AND o.deleted_at IS NULL
        WHERE c.org_id    = ${orgId}::uuid
          AND c.deleted_at IS NULL
          AND (${searchPat}::text IS NULL
               OR c.name   ILIKE ${searchPat}
               OR c.domain ILIKE ${searchPat})
          AND (${industryVal}::text IS NULL OR c.industry ILIKE ${industryVal})
        GROUP BY c.id
        ORDER BY "totalValue" DESC
        LIMIT ${limit}
      `;

      // Fetch contact counts for just the returned company IDs.
      const companyIds = rows.map((r) => r.id);
      const contacts = await prisma.contact.groupBy({
        by: ['companyId'],
        where: { orgId, companyId: { in: companyIds }, deletedAt: null },
        _count: { id: true },
      });
      const contactMap = new Map(contacts.map((c) => [c.companyId, c._count.id]));

      const items = rows.map((row, index) => ({
        id: row.id,
        name: row.name,
        domain: row.domain,
        industry: row.industry,
        logoUrl: row.logoUrl,
        tier: row.tier,
        keyAccountSince: row.keyAccountSince?.toISOString() ?? null,
        keyAccountOwnerId: row.keyAccountOwnerId,
        keyAccountNotes: row.keyAccountNotes,
        topAccountRank: index + 1, // rank = position in result (sorted by totalValue DESC)
        totalValue: row.totalValue,
        wonValue: row.wonValue,
        openDeals: Number(row.openDeals),
        contactCount: contactMap.get(row.id) ?? 0,
        opportunityCount: Number(row.opportunityCount),
      }));

      return reply.send({ items });
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

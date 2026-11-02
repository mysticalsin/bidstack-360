// Key Accounts & Top Accounts routes.
// Key accounts are manually flagged (tier = 'key') — regional strategic accounts.
// Top accounts are the admin-curated global top-10 (Company.topAccountRank);
// when no curation exists the endpoint falls back to an auto leaderboard
// ranked by total revenue/pipeline and labels the payload source: 'auto'.

import type { FastifyPluginAsync } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma, Prisma } from '@bidstack/db';
import { TOP_ACCOUNTS_MAX, TopAccountListUpdate, TopAccountsSource } from '@bidstack/shared';

import { emptyAccountStats, fetchAccountStats } from './accounts.helpers.js';
import { applyCompanyScope, countryVariantsForScope, getAccessScope } from '../lib/access-scope.js';

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
    preHandler: app.requirePermission('accounts:read'),
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
      const { orgId, userId } = req.auth;
      const { search, industry, ownerId, limit, cursor } = req.query;
      const scope = await getAccessScope(orgId, userId);

      const where = applyCompanyScope(
        {
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
        },
        scope,
      );

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

      // Exact Postgres aggregation (groupBy) — an in-JS reduce over a
      // take-capped findMany silently undercounts pipeline-heavy pages.
      const stats = await fetchAccountStats(orgId, companyIds);

      const items = page.map((c) => {
        const o = stats.get(c.id) ?? emptyAccountStats();
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
          contactCount: o.contactCount,
          opportunityCount: o.opportunityCount,
        };
      });

      return reply.send({ items, nextCursor });
    },
  });

  // GET /api/v1/accounts/top — curated global top-10 when an admin has set
  // Company.topAccountRank; otherwise the auto leaderboard by opportunity value.
  app.get('/accounts/top', {
    preHandler: app.requirePermission('accounts:read'),
    schema: {
      querystring: z.object({
        limit: z.coerce.number().int().min(1).max(100).default(20),
        search: z.string().max(200).optional(),
        industry: z.string().max(100).optional(),
      }),
      response: {
        200: z.object({ items: z.array(TopAccountResponse), source: TopAccountsSource }),
      },
    },
    handler: async (req, reply) => {
      const { orgId, userId } = req.auth;
      const { limit, search, industry } = req.query;
      const scope = await getAccessScope(orgId, userId);

      // Curated mode: ANY non-null rank in the org switches the endpoint to the
      // manually ordered list (search/industry still filter within it).
      const curatedCount = await prisma.company.count({
        where: applyCompanyScope({ orgId, deletedAt: null, topAccountRank: { not: null } }, scope),
      });
      if (curatedCount > 0) {
        const curated = await prisma.company.findMany({
          where: applyCompanyScope(
            {
              orgId,
              deletedAt: null,
              topAccountRank: { not: null },
              ...(search
                ? {
                    OR: [
                      { name: { contains: search, mode: 'insensitive' as const } },
                      { domain: { contains: search, mode: 'insensitive' as const } },
                    ],
                  }
                : {}),
              ...(industry ? { industry: { equals: industry, mode: 'insensitive' as const } } : {}),
            },
            scope,
          ),
          orderBy: { topAccountRank: 'asc' },
          take: Math.min(limit, TOP_ACCOUNTS_MAX),
        });

        const stats = await fetchAccountStats(
          orgId,
          curated.map((c) => c.id),
        );
        const items = curated.map((c) => {
          const s = stats.get(c.id) ?? emptyAccountStats();
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
            // topAccountRank is non-null by the where clause above; ?? 0 keeps TS honest.
            topAccountRank: c.topAccountRank ?? 0,
            totalValue: s.totalValue,
            wonValue: s.wonValue,
            openDeals: s.openDeals,
            contactCount: s.contactCount,
            opportunityCount: s.opportunityCount,
          };
        });
        return reply.send({ items, source: 'curated' as const });
      }

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
      const countryVariants = countryVariantsForScope(scope);
      const companyCountryScopeSql =
        !scope.unrestricted && countryVariants.length > 0
          ? Prisma.sql`c.country_code = ANY(ARRAY[${Prisma.join(countryVariants)}]::text[]) OR`
          : Prisma.empty;
      const opportunityCountryScopeSql =
        !scope.unrestricted && countryVariants.length > 0
          ? Prisma.sql`
              so.country = ANY(ARRAY[${Prisma.join(countryVariants)}]::text[])
              OR st.country_codes && ARRAY[${Prisma.join(countryVariants)}]::text[]
              OR`
          : Prisma.empty;
      const accountScopeSql = scope.unrestricted
        ? Prisma.empty
        : Prisma.sql`
            AND (
              ${companyCountryScopeSql}
              c.key_account_owner_id = ${userId}::uuid
              OR EXISTS (
                SELECT 1
                FROM opportunities so
                LEFT JOIN territories st ON st.id = so.territory_id
                WHERE so.company_id = c.id
                  AND so.org_id = ${orgId}::uuid
                  AND so.deleted_at IS NULL
                  AND (
                    ${opportunityCountryScopeSql}
                    so.owner_id = ${userId}::uuid
                  )
              )
            )
          `;

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
          ${accountScopeSql}
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

      return reply.send({ items, source: 'auto' as const });
    },
  });

  // PUT /api/v1/accounts/top-list — replace the curated global top-10.
  // Body order = rank order (index 0 → rank 1). An empty list clears curation
  // and reverts /accounts/top to the auto leaderboard.
  app.put('/accounts/top-list', {
    preHandler: [server.requirePermission('settings:write'), server.requireRole('admin')],
    schema: {
      body: TopAccountListUpdate,
      response: { 200: z.object({ companyIds: z.array(z.string().uuid()) }) },
    },
    handler: async (req, reply) => {
      const { orgId, userId } = req.auth;
      const { companyIds } = req.body;
      const scope = await getAccessScope(orgId, userId);
      if (!scope.unrestricted) {
        throw server.httpErrors.forbidden(
          'Global top-account curation requires unrestricted account scope',
        );
      }

      if (companyIds.length > 0) {
        const owned = await prisma.company.findMany({
          where: { id: { in: companyIds }, orgId, deletedAt: null },
          select: { id: true },
          take: TOP_ACCOUNTS_MAX,
        });
        if (owned.length !== companyIds.length) {
          const ownedIds = new Set(owned.map((c) => c.id));
          const missing = companyIds.filter((id) => !ownedIds.has(id));
          throw server.httpErrors.badRequest(
            `Companies not found in your organization: ${missing.join(', ')}`,
          );
        }
      }

      await prisma.$transaction(async (tx) => {
        // Clear every existing rank first so removed/reordered companies never
        // keep a stale position, then write rank 1..N in body order.
        await tx.company.updateMany({
          where: { orgId, topAccountRank: { not: null } },
          data: { topAccountRank: null },
        });
        for (const [index, companyId] of companyIds.entries()) {
          await tx.company.updateMany({
            where: { id: companyId, orgId, deletedAt: null },
            data: { topAccountRank: index + 1 },
          });
        }
        await tx.auditLog.create({
          data: {
            orgId,
            userId,
            action: 'accounts.top_list.update',
            targetType: 'company',
            targetId: null,
            diff: { companyIds },
          },
        });
      });

      return reply.send({ companyIds });
    },
  });

  // PATCH /api/v1/companies/:id/tier — update account tier
  app.patch('/companies/:id/tier', {
    preHandler: server.requirePermission('accounts:write'),
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        tier: z.enum(['key', 'top', 'standard']),
        // Optional = "leave unchanged"; explicit null = "clear". A tier-only
        // PATCH must never wipe the key-account owner/notes.
        keyAccountOwnerId: z.string().uuid().nullable().optional(),
        keyAccountNotes: z.string().max(2000).nullable().optional(),
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
      const { orgId, userId } = req.auth;
      const { id } = req.params;
      const { tier, keyAccountOwnerId, keyAccountNotes } = req.body;
      const scope = await getAccessScope(orgId, userId);

      const company = await prisma.company.findFirst({
        where: applyCompanyScope({ id, orgId, deletedAt: null }, scope),
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

      const updateData: Prisma.CompanyUpdateManyMutationInput = { tier };
      if (keyAccountOwnerId !== undefined) updateData.keyAccountOwnerId = keyAccountOwnerId;
      if (keyAccountNotes !== undefined) updateData.keyAccountNotes = keyAccountNotes;

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
    preHandler: app.requirePermission('accounts:read'),
    schema: {
      response: { 200: z.object({ items: z.array(z.string()) }) },
    },
    handler: async (req, reply) => {
      const { orgId, userId } = req.auth;
      const scope = await getAccessScope(orgId, userId);
      const rows = await prisma.company.findMany({
        where: applyCompanyScope({ orgId, deletedAt: null }, scope),
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

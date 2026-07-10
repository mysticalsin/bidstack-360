// Forecast and territory analytics routes (authenticated).
//
// Endpoints:
//   GET  /forecasts              — list org forecasts, filterable by period + owner
//   POST /forecasts              — upsert a forecast entry (period+category unique key)
//   GET  /territories/analytics  — world-map mission-control aggregate
//
// Territory CRUD        → territories.ts
// Lead routing rules    → territories-routing.ts

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma, Prisma } from '@bidstack/db';
import { Forecast, sumMicros } from '@bidstack/shared';
import { A2_TO_A3 } from '../lib/geo/iso-country-codes.js';

export const territoriesForecastRoutes: FastifyPluginAsyncZod = async (server) => {
  // GET /api/forecasts
  server.get(
    '/forecasts',
    {
      schema: {
        querystring: z.object({
          period: z.string().max(10).optional(),
          ownerId: z.string().uuid().optional(),
        }),
        response: { 200: z.object({ items: z.array(Forecast) }) },
      },
    },
    async (req) => {
      const rows = await prisma.forecast.findMany({
        where: {
          orgId: req.auth.orgId,
          ...(req.query.period ? { period: req.query.period } : {}),
          ...(req.query.ownerId ? { ownerId: req.query.ownerId } : {}),
        },
        include: { owner: { select: { name: true } } },
        orderBy: { period: 'desc' },
        take: 500,
      });
      return {
        items: rows.map((r) => ({
          id: r.id,
          orgId: r.orgId,
          ownerId: r.ownerId,
          ownerName: r.owner.name,
          period: r.period,
          category: r.category as Forecast['category'],
          amountMicros: Number(r.amountMicros),
          currency: r.currency,
          note: r.note,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        })),
      };
    },
  );

  // POST /api/forecasts
  server.post(
    '/forecasts',
    {
      preHandler: server.requirePermission('territories:write'),
      schema: {
        body: z.object({
          period: z.string().min(1).max(50),
          category: z.enum(['pipeline', 'best_case', 'commit', 'closed']),
          amountMicros: z.number().int().nonnegative().max(1_000_000_000_000_000),
          currency: z.string().length(3).default('EUR'),
          note: z.string().max(2000).optional(),
          // The Forecasts grid lists every owner's rows and edits them inline,
          // so a write must target the row's owner — not whoever is signed in.
          // Optional: absent ownerId = self-service edit (writes the caller's row).
          ownerId: z.string().uuid().optional(),
        }),
        response: { 201: Forecast },
      },
    },
    async (req, reply) => {
      // Resolve the forecast's owner. Default to the caller; if an explicit
      // ownerId is supplied (editing another rep's row), confirm that user
      // belongs to THIS org before writing — an authorized editor must never be
      // able to re-target a forecast onto a foreign-org user. Without this the
      // upsert silently keyed on req.auth.userId, so every peer-cell edit wrote
      // the editor's own row instead of the row on screen.
      const targetOwnerId = req.body.ownerId ?? req.auth.userId;
      if (targetOwnerId !== req.auth.userId) {
        const member = await prisma.user.findFirst({
          where: { id: targetOwnerId, orgId: req.auth.orgId, deletedAt: null },
          select: { id: true },
        });
        if (!member) {
          throw server.httpErrors.badRequest(
            'Forecast owner must be a member of this organization',
          );
        }
      }
      const created = await prisma.forecast.upsert({
        where: {
          orgId_ownerId_period_category: {
            orgId: req.auth.orgId,
            ownerId: targetOwnerId,
            period: req.body.period,
            category: req.body.category,
          },
        },
        create: {
          orgId: req.auth.orgId,
          ownerId: targetOwnerId,
          period: req.body.period,
          category: req.body.category,
          amountMicros: BigInt(req.body.amountMicros),
          currency: req.body.currency,
          note: req.body.note ?? null,
        },
        update: {
          amountMicros: BigInt(req.body.amountMicros),
          currency: req.body.currency,
          note: req.body.note ?? null,
        },
        include: { owner: { select: { name: true } } },
      });
      return reply.code(201).send({
        id: created.id,
        orgId: created.orgId,
        ownerId: created.ownerId,
        ownerName: created.owner.name,
        period: created.period,
        category: created.category as Forecast['category'],
        amountMicros: Number(created.amountMicros),
        currency: created.currency,
        note: created.note,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      });
    },
  );

  // DELETE /api/forecasts/:id — remove a forecast row. Org-scoped so a row can
  // never be deleted across tenants; the grid's row-delete fans this out over
  // each category id for a period+owner. (The web Delete button previously 404'd
  // because no delete route existed.)
  server.delete(
    '/forecasts/:id',
    {
      preHandler: server.requirePermission('territories:write'),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ deleted: z.boolean() }) },
      },
    },
    async (req) => {
      const result = await prisma.forecast.deleteMany({
        where: { id: req.params.id, orgId: req.auth.orgId },
      });
      if (result.count === 0) throw server.httpErrors.notFound('Forecast not found');
      return { deleted: true };
    },
  );

  // GET /api/territories/analytics — mission-control data for the world map
  server.get(
    '/territories/analytics',
    {
      schema: {
        response: {
          200: z.object({
            items: z.array(
              z.object({
                countryCode: z.string(),
                countryCodeA3: z.string(),
                opportunityCount: z.number().int(),
                totalValueMicros: z.number(),
                avgProbability: z.number(),
                territories: z.array(z.string()),
                ownerNames: z.array(z.string()),
              }),
            ),
            totals: z.object({
              totalCountries: z.number().int(),
              totalValueMicros: z.number(),
              totalOpportunities: z.number().int(),
              avgProbability: z.number(),
            }),
          }),
        },
      },
    },
    async (req) => {
      // Aggregate opportunities by country code over the FULL, non-deleted set.
      // WHY raw GROUP BY (not prisma.groupBy): the grouping key is a COALESCE
      // expression spanning a relation array (o.country → territory.country_codes[0]
      // → 'Unknown'), and we need DISTINCT relation-name arrays (territory/owner)
      // per group — neither is expressible via prisma.opportunity.groupBy.
      // Replaces a take:1000 findMany that returned a non-deterministic,
      // soft-delete-polluted sample as the authoritative total at scale.
      // value_micros sum is cast ::text so the driver returns a deterministic
      // string we convert to BigInt for precision-safe sorting (a bare
      // SUM(bigint) returns numeric, which node-postgres serializes as a string —
      // sorting those lexicographically would mis-order). probability sum is
      // ::float8 (cap 100/row × millions of rows overflows int4). count is ::int.
      const rows = await prisma.$queryRaw<
        Array<{
          countryCode: string;
          opportunityCount: number;
          totalValueMicros: string;
          sumProbability: number;
          territories: string[];
          ownerNames: string[];
        }>
      >(Prisma.sql`
        SELECT
          COALESCE(o.country, t.country_codes[1], 'Unknown') AS "countryCode",
          COUNT(*)::int AS "opportunityCount",
          COALESCE(SUM(o.value_micros), 0)::text AS "totalValueMicros",
          COALESCE(SUM(o.probability), 0)::float8 AS "sumProbability",
          COALESCE(
            array_agg(DISTINCT t.name) FILTER (WHERE t.name IS NOT NULL),
            ARRAY[]::text[]
          ) AS "territories",
          COALESCE(
            array_agg(DISTINCT u.name) FILTER (WHERE u.name IS NOT NULL),
            ARRAY[]::text[]
          ) AS "ownerNames"
        FROM opportunities o
        LEFT JOIN territories t ON t.id = o.territory_id
        LEFT JOIN users u ON u.id = o.owner_id
        WHERE o.org_id = ${req.auth.orgId}::uuid
          AND o.deleted_at IS NULL
        GROUP BY COALESCE(o.country, t.country_codes[1], 'Unknown')
      `);

      // WHY: sort on BigInt before converting to Number so aggregate values
      // above ~$9B (9_000_000_000_000_000 micros) aren't silently reordered
      // by IEEE-754 precision loss.
      const sorted = [...rows].sort((a, b) => {
        const av = BigInt(a.totalValueMicros);
        const bv = BigInt(b.totalValueMicros);
        return av > bv ? -1 : av < bv ? 1 : 0;
      });

      const items = sorted.map((c) => ({
        countryCode: c.countryCode,
        countryCodeA3: A2_TO_A3[c.countryCode] ?? c.countryCode,
        opportunityCount: c.opportunityCount,
        totalValueMicros: Number(c.totalValueMicros),
        avgProbability:
          c.opportunityCount > 0
            ? Math.round((c.sumProbability / c.opportunityCount) * 10) / 10
            : 0,
        territories: c.territories,
        ownerNames: c.ownerNames,
      }));

      const totalOpportunities = items.reduce((s, i) => s + i.opportunityCount, 0);
      // Sum the source BigInt strings, not the already-Number()-converted
      // per-country totals — a float reduce() over Numbers re-introduces the
      // precision loss sumMicros exists to avoid (same class of bug fixed in
      // accounts.helpers.ts / forecast.service.ts). This field is denominated
      // in micros (matches the per-row Number(c.totalValueMicros) above), so
      // convert once at the boundary — no unit division, unlike microsToUnits.
      const totalValueMicros = Number(sumMicros(rows.map((r) => BigInt(r.totalValueMicros))));
      const totalProbability = rows.reduce((s, r) => s + r.sumProbability, 0);
      const avgProbability =
        totalOpportunities > 0
          ? Math.round((totalProbability / totalOpportunities) * 10) / 10
          : 0;

      return {
        items,
        totals: {
          totalCountries: items.length,
          totalValueMicros,
          totalOpportunities,
          avgProbability,
        },
      };
    },
  );

  // GET /api/territories/segments?dimension=industry|account|country
  // Generalised opportunity breakdown: the same count/value/avg-probability
  // aggregation as /analytics, but grouped by ANY business dimension instead of
  // only geography. Lets the territories view answer "opps per industry" and
  // "opps per account", not just per region.
  const SegmentDimension = z.enum(['industry', 'account', 'country']);
  server.get(
    '/territories/segments',
    {
      preHandler: server.requirePermission('territories:read'),
      schema: {
        querystring: z.object({ dimension: SegmentDimension.default('industry') }),
        response: {
          200: z.object({
            dimension: SegmentDimension,
            items: z.array(
              z.object({
                key: z.string(),
                label: z.string(),
                opportunityCount: z.number().int(),
                totalValueMicros: z.number(),
                avgProbability: z.number(),
                ownerNames: z.array(z.string()),
              }),
            ),
            totals: z.object({
              totalSegments: z.number().int(),
              totalValueMicros: z.number(),
              totalOpportunities: z.number().int(),
              avgProbability: z.number(),
            }),
          }),
        },
      },
    },
    async (req) => {
      const dimension = req.query.dimension;

      // Resolve the grouping-key expression for the chosen dimension. Industry
      // falls back from the opp to its company; account prefers the linked
      // company name over the free-text customer label; country falls back to
      // 'Unknown'. Same precedence as the prior in-JS keyFor().
      const keyExpr =
        dimension === 'industry'
          ? Prisma.sql`COALESCE(o.industry, c.industry, 'Unspecified')`
          : dimension === 'account'
            ? Prisma.sql`COALESCE(c.name, o.customer, 'Unknown')`
            : Prisma.sql`COALESCE(o.country, 'Unknown')`;

      // Aggregate over the FULL, non-deleted set in Postgres. WHY raw GROUP BY
      // (not prisma.groupBy): the key is a COALESCE spanning a relation and we
      // need DISTINCT owner-name arrays per group. Replaces a take:1000 findMany
      // that returned a non-deterministic, soft-delete-polluted authoritative sample.
      // See /analytics above for the ::text / ::float8 / ::int cast rationale
      // (driver returns numeric SUMs as strings; BigInt-safe sort needs them).
      const rows = await prisma.$queryRaw<
        Array<{
          key: string;
          opportunityCount: number;
          totalValueMicros: string;
          sumProbability: number;
          ownerNames: string[];
        }>
      >(Prisma.sql`
        SELECT
          ${keyExpr} AS "key",
          COUNT(*)::int AS "opportunityCount",
          COALESCE(SUM(o.value_micros), 0)::text AS "totalValueMicros",
          COALESCE(SUM(o.probability), 0)::float8 AS "sumProbability",
          COALESCE(
            array_agg(DISTINCT u.name) FILTER (WHERE u.name IS NOT NULL),
            ARRAY[]::text[]
          ) AS "ownerNames"
        FROM opportunities o
        LEFT JOIN companies c ON c.id = o.company_id
        LEFT JOIN users u ON u.id = o.owner_id
        WHERE o.org_id = ${req.auth.orgId}::uuid
          AND o.deleted_at IS NULL
        GROUP BY ${keyExpr}
      `);

      // Sort on BigInt before Number conversion (precision-safe above ~$9B).
      const items = [...rows]
        .sort((a, b) => {
          const av = BigInt(a.totalValueMicros);
          const bv = BigInt(b.totalValueMicros);
          return av > bv ? -1 : av < bv ? 1 : 0;
        })
        .map((g) => ({
          key: g.key,
          label: g.key,
          opportunityCount: g.opportunityCount,
          totalValueMicros: Number(g.totalValueMicros),
          avgProbability:
            g.opportunityCount > 0
              ? Math.round((g.sumProbability / g.opportunityCount) * 10) / 10
              : 0,
          ownerNames: g.ownerNames,
        }));

      const totalOpportunities = items.reduce((s, i) => s + i.opportunityCount, 0);
      const totalProbability = rows.reduce((s, r) => s + r.sumProbability, 0);
      return {
        dimension,
        items,
        totals: {
          totalSegments: items.length,
          // Sum the source BigInt strings, not the already-Number()-converted
          // per-segment totals — same float-precision fix as /territories/analytics above.
          totalValueMicros: Number(sumMicros(rows.map((r) => BigInt(r.totalValueMicros)))),
          totalOpportunities,
          avgProbability:
            totalOpportunities > 0
              ? Math.round((totalProbability / totalOpportunities) * 10) / 10
              : 0,
        },
      };
    },
  );
};

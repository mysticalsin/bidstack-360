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
import { prisma } from '@bidstack/db';
import { Forecast } from '@bidstack/shared';
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
        }),
        response: { 201: Forecast },
      },
    },
    async (req, reply) => {
      const created = await prisma.forecast.upsert({
        where: {
          orgId_ownerId_period_category: {
            orgId: req.auth.orgId,
            ownerId: req.auth.userId,
            period: req.body.period,
            category: req.body.category,
          },
        },
        create: {
          orgId: req.auth.orgId,
          ownerId: req.auth.userId,
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
      // Aggregate opportunities by country code.
      const rows = await prisma.opportunity.findMany({
        where: { orgId: req.auth.orgId },
        select: {
          id: true,
          valueMicros: true,
          probability: true,
          country: true,
          territoryId: true,
          owner: { select: { name: true } },
          territory: { select: { name: true, countryCodes: true } },
        },
        take: 1000,
      });

      const byCountry = new Map<
        string,
        {
          countryCode: string;
          countryCodeA3: string;
          opportunityCount: number;
          totalValueMicros: bigint;
          avgProbability: number;
          probabilities: number[];
          territories: Set<string>;
          ownerNames: Set<string>;
        }
      >();

      for (const row of rows) {
        // Derive country: opportunity.country → territory.countryCodes[0] → 'Unknown'
        const a2 = row.country ?? row.territory?.countryCodes[0] ?? 'Unknown';
        const a3 = A2_TO_A3[a2] ?? a2;
        const val = row.valueMicros ?? BigInt(0);
        const existing = byCountry.get(a2);
        if (existing) {
          existing.opportunityCount += 1;
          existing.totalValueMicros += val;
          existing.probabilities.push(row.probability ?? 0);
          if (row.territory?.name) existing.territories.add(row.territory.name);
          if (row.owner?.name) existing.ownerNames.add(row.owner.name);
        } else {
          byCountry.set(a2, {
            countryCode: a2,
            countryCodeA3: a3,
            opportunityCount: 1,
            totalValueMicros: val,
            avgProbability: row.probability ?? 0,
            probabilities: [row.probability ?? 0],
            territories: new Set(row.territory?.name ? [row.territory.name] : []),
            ownerNames: new Set(row.owner?.name ? [row.owner.name] : []),
          });
        }
      }

      // WHY: sort on BigInt before converting to Number so aggregate values
      // above ~$9B (9_000_000_000_000_000 micros) aren't silently reordered
      // by IEEE-754 precision loss. Safe to do before the map because
      // byCountry.values() is a plain JS iterator over our own Map.
      const sorted = [...byCountry.values()].sort((a, b) =>
        a.totalValueMicros > b.totalValueMicros
          ? -1
          : a.totalValueMicros < b.totalValueMicros
            ? 1
            : 0,
      );

      const items = sorted.map((c) => ({
        countryCode: c.countryCode,
        countryCodeA3: c.countryCodeA3,
        opportunityCount: c.opportunityCount,
        totalValueMicros: Number(c.totalValueMicros),
        avgProbability:
          c.probabilities.length > 0
            ? Math.round(
                (c.probabilities.reduce((a, b) => a + b, 0) / c.probabilities.length) * 10,
              ) / 10
            : 0,
        territories: [...c.territories],
        ownerNames: [...c.ownerNames],
      }));

      const totalOpportunities = items.reduce((s, i) => s + i.opportunityCount, 0);
      const totalValueMicros = items.reduce((s, i) => s + i.totalValueMicros, 0);
      const avgProbability =
        totalOpportunities > 0
          ? Math.round((rows.reduce((s, r) => s + (r.probability ?? 0), 0) / rows.length) * 10) / 10
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
      const rows = await prisma.opportunity.findMany({
        where: { orgId: req.auth.orgId },
        select: {
          valueMicros: true,
          probability: true,
          industry: true,
          country: true,
          customer: true,
          owner: { select: { name: true } },
          company: { select: { name: true, industry: true } },
        },
        take: 1000,
      });

      // Resolve the grouping key for a row by the chosen dimension. Industry
      // falls back from the opp to its company; account prefers the linked
      // company name over the free-text customer label.
      const keyFor = (row: (typeof rows)[number]): string => {
        if (dimension === 'industry') return row.industry ?? row.company?.industry ?? 'Unspecified';
        if (dimension === 'account') return row.company?.name ?? row.customer ?? 'Unknown';
        return row.country ?? 'Unknown';
      };

      const groups = new Map<
        string,
        { totalValueMicros: bigint; count: number; probabilities: number[]; owners: Set<string> }
      >();
      for (const row of rows) {
        const key = keyFor(row);
        const g = groups.get(key) ?? {
          totalValueMicros: BigInt(0),
          count: 0,
          probabilities: [],
          owners: new Set<string>(),
        };
        g.totalValueMicros += row.valueMicros ?? BigInt(0);
        g.count += 1;
        g.probabilities.push(row.probability ?? 0);
        if (row.owner?.name) g.owners.add(row.owner.name);
        groups.set(key, g);
      }

      // Sort on BigInt before Number conversion (precision-safe above ~$9B).
      const items = [...groups.entries()]
        .sort((a, b) =>
          a[1].totalValueMicros > b[1].totalValueMicros
            ? -1
            : a[1].totalValueMicros < b[1].totalValueMicros
              ? 1
              : 0,
        )
        .map(([key, g]) => ({
          key,
          label: key,
          opportunityCount: g.count,
          totalValueMicros: Number(g.totalValueMicros),
          avgProbability:
            g.probabilities.length > 0
              ? Math.round(
                  (g.probabilities.reduce((s, p) => s + p, 0) / g.probabilities.length) * 10,
                ) / 10
              : 0,
          ownerNames: [...g.owners],
        }));

      const totalOpportunities = items.reduce((s, i) => s + i.opportunityCount, 0);
      return {
        dimension,
        items,
        totals: {
          totalSegments: items.length,
          totalValueMicros: items.reduce((s, i) => s + i.totalValueMicros, 0),
          totalOpportunities,
          avgProbability:
            rows.length > 0
              ? Math.round((rows.reduce((s, r) => s + (r.probability ?? 0), 0) / rows.length) * 10) /
                10
              : 0,
        },
      };
    },
  );
};

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@bidstack/db';
import { Territory, LeadRoutingRule, Forecast } from '@bidstack/shared';

// ISO-3166 alpha-3 to alpha-2 mapping for common countries used in sales data.
// react-simple-maps uses alpha-3 (numeric ISO codes in the topojson), but our
// DB stores alpha-2 country codes. We map alpha-2 → alpha-3 for the map.
const A2_TO_A3: Record<string, string> = {
  AF: 'AFG',
  AL: 'ALB',
  DZ: 'DZA',
  AD: 'AND',
  AO: 'AGO',
  AR: 'ARG',
  AM: 'ARM',
  AU: 'AUS',
  AT: 'AUT',
  AZ: 'AZE',
  BS: 'BHS',
  BH: 'BHR',
  BD: 'BGD',
  BY: 'BLR',
  BE: 'BEL',
  BZ: 'BLZ',
  BJ: 'BEN',
  BT: 'BTN',
  BO: 'BOL',
  BA: 'BIH',
  BW: 'BWA',
  BR: 'BRA',
  BN: 'BRN',
  BG: 'BGR',
  BF: 'BFA',
  BI: 'BDI',
  KH: 'KHM',
  CM: 'CMR',
  CA: 'CAN',
  CV: 'CPV',
  CF: 'CAF',
  TD: 'TCD',
  CL: 'CHL',
  CN: 'CHN',
  CO: 'COL',
  KM: 'COM',
  CG: 'COG',
  CR: 'CRI',
  HR: 'HRV',
  CU: 'CUB',
  CY: 'CYP',
  CZ: 'CZE',
  DK: 'DNK',
  DJ: 'DJI',
  DO: 'DOM',
  EC: 'ECU',
  EG: 'EGY',
  SV: 'SLV',
  GQ: 'GNQ',
  ER: 'ERI',
  EE: 'EST',
  ET: 'ETH',
  FJ: 'FJI',
  FI: 'FIN',
  FR: 'FRA',
  GA: 'GAB',
  GM: 'GMB',
  GE: 'GEO',
  DE: 'DEU',
  GH: 'GHA',
  GR: 'GRC',
  GT: 'GTM',
  GN: 'GIN',
  GW: 'GNB',
  GY: 'GUY',
  HT: 'HTI',
  HN: 'HND',
  HU: 'HUN',
  IS: 'ISL',
  IN: 'IND',
  ID: 'IDN',
  IR: 'IRN',
  IQ: 'IRQ',
  IE: 'IRL',
  IL: 'ISR',
  IT: 'ITA',
  JM: 'JAM',
  JP: 'JPN',
  JO: 'JOR',
  KZ: 'KAZ',
  KE: 'KEN',
  KI: 'KIR',
  KP: 'PRK',
  KR: 'KOR',
  KW: 'KWT',
  KG: 'KGZ',
  LA: 'LAO',
  LV: 'LVA',
  LB: 'LBN',
  LS: 'LSO',
  LR: 'LBR',
  LY: 'LBY',
  LI: 'LIE',
  LT: 'LTU',
  LU: 'LUX',
  MK: 'MKD',
  MG: 'MDG',
  MW: 'MWI',
  MY: 'MYS',
  MV: 'MDV',
  ML: 'MLI',
  MT: 'MLT',
  MR: 'MRT',
  MU: 'MUS',
  MX: 'MEX',
  MD: 'MDA',
  MC: 'MCO',
  MN: 'MNG',
  ME: 'MNE',
  MA: 'MAR',
  MZ: 'MOZ',
  MM: 'MMR',
  NA: 'NAM',
  NR: 'NRU',
  NP: 'NPL',
  NL: 'NLD',
  NZ: 'NZL',
  NI: 'NIC',
  NE: 'NER',
  NG: 'NGA',
  NO: 'NOR',
  OM: 'OMN',
  PK: 'PAK',
  PA: 'PAN',
  PG: 'PNG',
  PY: 'PRY',
  PE: 'PER',
  PH: 'PHL',
  PL: 'POL',
  PT: 'PRT',
  QA: 'QAT',
  RO: 'ROU',
  RU: 'RUS',
  RW: 'RWA',
  SA: 'SAU',
  SN: 'SEN',
  RS: 'SRB',
  SL: 'SLE',
  SG: 'SGP',
  SK: 'SVK',
  SI: 'SVN',
  SB: 'SLB',
  SO: 'SOM',
  ZA: 'ZAF',
  SS: 'SSD',
  ES: 'ESP',
  LK: 'LKA',
  SD: 'SDN',
  SR: 'SUR',
  SE: 'SWE',
  CH: 'CHE',
  SY: 'SYR',
  TW: 'TWN',
  TJ: 'TJK',
  TZ: 'TZA',
  TH: 'THA',
  TL: 'TLS',
  TG: 'TGO',
  TT: 'TTO',
  TN: 'TUN',
  TR: 'TUR',
  TM: 'TKM',
  UG: 'UGA',
  UA: 'UKR',
  AE: 'ARE',
  GB: 'GBR',
  US: 'USA',
  UY: 'URY',
  UZ: 'UZB',
  VE: 'VEN',
  VN: 'VNM',
  YE: 'YEM',
  ZM: 'ZMB',
  ZW: 'ZWE',
};

export const territoryRoutes: FastifyPluginAsyncZod = async (server) => {
  // GET /api/territories
  server.get(
    '/territories',
    {
      schema: { response: { 200: z.object({ items: z.array(Territory) }) } },
    },
    async (req) => {
      const rows = await prisma.territory.findMany({
        where: { orgId: req.auth.orgId, active: true },
        include: { owner: { select: { name: true } } },
        orderBy: { name: 'asc' },
      });
      return {
        items: rows.map((r) => ({
          id: r.id,
          orgId: r.orgId,
          name: r.name,
          countryCodes: r.countryCodes,
          region: r.region,
          postalCodes: r.postalCodes,
          ownerId: r.ownerId,
          ownerName: r.owner.name,
          active: r.active,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        })),
      };
    },
  );

  // GET /api/lead-routing-rules
  server.get(
    '/lead-routing-rules',
    {
      schema: { response: { 200: z.object({ items: z.array(LeadRoutingRule) }) } },
    },
    async (req) => {
      const rows = await prisma.leadRoutingRule.findMany({
        where: { orgId: req.auth.orgId, active: true },
        orderBy: { priority: 'desc' },
      });
      return {
        items: rows.map((r) => ({
          id: r.id,
          orgId: r.orgId,
          name: r.name,
          active: r.active,
          priority: r.priority,
          criteria: r.criteria as Record<string, unknown>,
          assignToUserId: r.assignToUserId,
          assignToTerritoryId: r.assignToTerritoryId,
          roundRobinTeam: r.roundRobinTeam,
          roundRobinIndex: r.roundRobinIndex,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        })),
      };
    },
  );

  // POST /api/lead-routing-rules/evaluate
  server.post(
    '/lead-routing-rules/evaluate',
    {
      schema: {
        body: z.object({
          industry: z.string().optional(),
          countryCode: z.string().optional(),
          valueMicros: z.number().optional(),
        }),
        response: {
          200: z.object({
            matchedRuleId: z.string().nullable(),
            assignToUserId: z.string().nullable(),
            assignToTerritoryId: z.string().nullable(),
          }),
        },
      },
    },
    async (req) => {
      const rules = await prisma.leadRoutingRule.findMany({
        where: { orgId: req.auth.orgId, active: true },
        orderBy: { priority: 'desc' },
      });
      for (const rule of rules) {
        const criteria = rule.criteria as Record<string, unknown>;
        let match = true;
        if (criteria.industry && req.body.industry !== criteria.industry) match = false;
        if (criteria.countryCode && req.body.countryCode !== criteria.countryCode) match = false;
        if (criteria.minValue && (req.body.valueMicros ?? 0) < Number(criteria.minValue))
          match = false;
        if (match) {
          return {
            matchedRuleId: rule.id,
            assignToUserId: rule.assignToUserId,
            assignToTerritoryId: rule.assignToTerritoryId,
          };
        }
      }
      return { matchedRuleId: null, assignToUserId: null, assignToTerritoryId: null };
    },
  );

  // GET /api/forecasts
  server.get(
    '/forecasts',
    {
      schema: {
        querystring: z.object({
          period: z.string().optional(),
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
      schema: {
        body: z.object({
          period: z.string().min(1),
          category: z.enum(['pipeline', 'best_case', 'commit', 'closed']),
          amountMicros: z.number().int().nonnegative(),
          currency: z.string().length(3).default('EUR'),
          note: z.string().optional(),
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

      // Prisma Decimal → number helper
      const _toNum = (v: unknown): number => {
        if (v === null || v === undefined) return 0;
        if (typeof v === 'number') return v;
        if (typeof v === 'string') return Number(v);
        if (
          typeof v === 'object' &&
          v !== null &&
          'toNumber' in v &&
          typeof (v as { toNumber: () => number }).toNumber === 'function'
        ) {
          return (v as { toNumber: () => number }).toNumber();
        }
        return Number(v);
      };

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

      const items = [...byCountry.values()].map((c) => ({
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

      items.sort((a, b) => b.totalValueMicros - a.totalValueMicros);

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
};

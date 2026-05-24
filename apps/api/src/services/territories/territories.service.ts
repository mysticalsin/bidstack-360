import type { z } from 'zod';
import { prisma, type Prisma } from '@bidstack/db';
import type {
  Territory,
  LeadRoutingRule,
  Forecast,
} from '@bidstack/shared';

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

function serializeTerritory(r: {
  id: string;
  orgId: string;
  name: string;
  countryCodes: string[];
  region: string | null;
  postalCodes: string[];
  ownerId: string;
  owner: { name: string | null };
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}): z.infer<typeof Territory> {
  return {
    id: r.id,
    orgId: r.orgId,
    name: r.name,
    countryCodes: r.countryCodes,
    region: r.region,
    postalCodes: r.postalCodes,
    ownerId: r.ownerId,
    ownerName: r.owner.name ?? '',
    active: r.active,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function serializeLeadRoutingRule(r: {
  id: string;
  orgId: string;
  name: string;
  active: boolean;
  priority: number;
  criteria: Prisma.JsonValue;
  assignToUserId: string | null;
  assignToTerritoryId: string | null;
  roundRobinTeam: string[];
  roundRobinIndex: number;
  createdAt: Date;
  updatedAt: Date;
}): z.infer<typeof LeadRoutingRule> {
  return {
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
  };
}

function serializeForecast(r: {
  id: string;
  orgId: string;
  ownerId: string;
  owner: { name: string | null };
  period: string;
  category: string;
  amountMicros: bigint;
  currency: string;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}): z.infer<typeof Forecast> {
  return {
    id: r.id,
    orgId: r.orgId,
    ownerId: r.ownerId,
    ownerName: r.owner.name ?? '',
    period: r.period,
    category: r.category as z.infer<typeof Forecast>['category'],
    amountMicros: Number(r.amountMicros),
    currency: r.currency,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function listTerritories(orgId: string) {
  const rows = await prisma.territory.findMany({
    where: { orgId, active: true },
    include: { owner: { select: { name: true } } },
    orderBy: { name: 'asc' },
  });
  return rows.map(serializeTerritory);
}

export async function createTerritory(
  orgId: string,
  body: {
    name: string;
    countryCodes: string[];
    region?: string | null;
    postalCodes?: string[];
    ownerId: string;
    active?: boolean;
  },
) {
  const created = await prisma.territory.create({
    data: {
      orgId,
      name: body.name,
      countryCodes: body.countryCodes,
      region: body.region,
      postalCodes: body.postalCodes,
      ownerId: body.ownerId,
      active: body.active,
    },
    include: { owner: { select: { name: true } } },
  });
  return serializeTerritory(created);
}

export async function updateTerritory(
  orgId: string,
  id: string,
  body: {
    name?: string;
    countryCodes?: string[];
    region?: string | null;
    postalCodes?: string[];
    ownerId?: string;
    active?: boolean;
  },
) {
  const data: Prisma.TerritoryUpdateInput = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.countryCodes !== undefined) data.countryCodes = body.countryCodes;
  if (body.region !== undefined) data.region = body.region;
  if (body.postalCodes !== undefined) data.postalCodes = body.postalCodes;
  if (body.ownerId !== undefined) data.owner = { connect: { id: body.ownerId } };
  if (body.active !== undefined) data.active = body.active;

  const updated = await prisma.territory.update({
    where: { id, orgId },
    data,
    include: { owner: { select: { name: true } } },
  });
  return serializeTerritory(updated);
}

export async function deleteTerritory(orgId: string, id: string) {
  await prisma.territory.update({
    where: { id, orgId },
    data: { deletedAt: new Date(), active: false },
  });
  return { ok: true };
}

export async function listLeadRoutingRules(orgId: string) {
  const rows = await prisma.leadRoutingRule.findMany({
    where: { orgId, active: true },
    orderBy: { priority: 'desc' },
  });
  return rows.map(serializeLeadRoutingRule);
}

export async function createLeadRoutingRule(
  orgId: string,
  body: {
    name: string;
    active?: boolean;
    priority?: number;
    criteria: Record<string, unknown>;
    assignToUserId?: string | null;
    assignToTerritoryId?: string | null;
    roundRobinTeam?: readonly string[] | null;
    roundRobinIndex?: number;
  },
) {
  const created = await prisma.leadRoutingRule.create({
    data: {
      orgId,
      name: body.name,
      active: body.active ?? true,
      priority: body.priority ?? 0,
      criteria: body.criteria as Prisma.InputJsonValue,
      assignToUserId: body.assignToUserId ?? null,
      assignToTerritoryId: body.assignToTerritoryId ?? null,
      roundRobinTeam: body.roundRobinTeam ? [...body.roundRobinTeam] : [],
      roundRobinIndex: body.roundRobinIndex ?? 0,
    },
  });
  return serializeLeadRoutingRule(created);
}

export async function updateLeadRoutingRule(
  orgId: string,
  id: string,
  body: {
    name?: string;
    active?: boolean;
    priority?: number;
    criteria?: Record<string, unknown>;
    assignToUserId?: string | null;
    assignToTerritoryId?: string | null;
    roundRobinTeam?: readonly string[];
    roundRobinIndex?: number;
  },
) {
  const data: Prisma.LeadRoutingRuleUpdateInput = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.active !== undefined) data.active = body.active;
  if (body.priority !== undefined) data.priority = body.priority;
  if (body.criteria !== undefined) data.criteria = body.criteria as Prisma.InputJsonValue;
  if (body.assignToUserId !== undefined) data.assignToUserId = body.assignToUserId;
  if (body.assignToTerritoryId !== undefined) data.assignToTerritoryId = body.assignToTerritoryId;
  if (body.roundRobinTeam !== undefined) data.roundRobinTeam = [...body.roundRobinTeam];
  if (body.roundRobinIndex !== undefined) data.roundRobinIndex = body.roundRobinIndex;

  const updated = await prisma.leadRoutingRule.update({
    where: { id, orgId },
    data,
  });
  return serializeLeadRoutingRule(updated);
}

export async function deleteLeadRoutingRule(orgId: string, id: string) {
  await prisma.leadRoutingRule.update({
    where: { id, orgId },
    data: { deletedAt: new Date(), active: false },
  });
  return { ok: true };
}

export async function evaluateLeadRoutingRule(
  orgId: string,
  input: {
    industry?: string;
    countryCode?: string;
    valueMicros?: number;
  },
) {
  const rules = await prisma.leadRoutingRule.findMany({
    where: { orgId, active: true },
    orderBy: { priority: 'desc' },
  });

  for (const rule of rules) {
    const criteria = rule.criteria as Record<string, unknown>;
    let match = true;
    if (criteria.industry && input.industry !== criteria.industry) match = false;
    if (criteria.countryCode && input.countryCode !== criteria.countryCode) match = false;
    if (criteria.minValue && (input.valueMicros ?? 0) < Number(criteria.minValue))
      match = false;
    if (match) {
      // Round-robin: if team is defined, pick next user and advance index
      let assignToUserId = rule.assignToUserId;
      if (rule.roundRobinTeam && rule.roundRobinTeam.length > 0) {
        const team = rule.roundRobinTeam;
        const idx = rule.roundRobinIndex % team.length;
        assignToUserId = team[idx] ?? null;
        // Advance index atomically for next evaluation
        await prisma.$transaction([
          prisma.leadRoutingRule.updateMany({
            where: { id: rule.id, orgId },
            data: { roundRobinIndex: { increment: 1 } },
          }),
        ]);
      }
      return {
        matchedRuleId: rule.id,
        assignToUserId,
        assignToTerritoryId: rule.assignToTerritoryId,
      };
    }
  }

  return { matchedRuleId: null, assignToUserId: null, assignToTerritoryId: null };
}

export async function listForecasts(
  orgId: string,
  filters: { period?: string; ownerId?: string },
) {
  const rows = await prisma.forecast.findMany({
    where: {
      orgId,
      ...(filters.period ? { period: filters.period } : {}),
      ...(filters.ownerId ? { ownerId: filters.ownerId } : {}),
    },
    include: { owner: { select: { name: true } } },
    orderBy: { period: 'desc' },
  });
  return rows.map(serializeForecast);
}

export async function upsertForecast(
  orgId: string,
  ownerId: string,
  body: {
    period: string;
    category: string;
    amountMicros: number;
    currency: string;
    note?: string;
  },
) {
  const created = await prisma.forecast.upsert({
    where: {
      orgId_ownerId_period_category: {
        orgId,
        ownerId,
        period: body.period,
        category: body.category,
      },
    },
    create: {
      orgId,
      ownerId,
      period: body.period,
      category: body.category,
      amountMicros: BigInt(body.amountMicros),
      currency: body.currency,
      note: body.note ?? null,
    },
    update: {
      amountMicros: BigInt(body.amountMicros),
      currency: body.currency,
      note: body.note ?? null,
    },
    include: { owner: { select: { name: true } } },
  });
  return serializeForecast(created);
}

export async function getTerritoryAnalytics(orgId: string) {
  // Aggregate opportunities by country code.
  const rows = await prisma.opportunity.findMany({
    where: { orgId },
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
}

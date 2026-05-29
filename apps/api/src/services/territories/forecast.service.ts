import type { z } from 'zod';
import { prisma } from '@bidstack/db';
import type { Forecast } from '@bidstack/shared';
import { A2_TO_A3 } from '../../lib/geo/iso-country-codes.js';

// ─── Serializer ───────────────────────────────────────────────────────────────

export function serializeForecast(r: {
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

// ─── Forecast CRUD ────────────────────────────────────────────────────────────

export async function listForecasts(orgId: string, filters: { period?: string; ownerId?: string }) {
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

// ─── Territory analytics ──────────────────────────────────────────────────────

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

  // WHY sort on BigInt before converting to Number: avoids IEEE-754 precision
  // loss on aggregate values above ~$9B (9_000_000_000_000_000 micros).
  const sorted = [...byCountry.values()].sort((a, b) =>
    a.totalValueMicros > b.totalValueMicros ? -1 : a.totalValueMicros < b.totalValueMicros ? 1 : 0,
  );

  const items = sorted.map((c) => ({
    countryCode: c.countryCode,
    countryCodeA3: c.countryCodeA3,
    opportunityCount: c.opportunityCount,
    totalValueMicros: Number(c.totalValueMicros),
    avgProbability:
      c.probabilities.length > 0
        ? Math.round((c.probabilities.reduce((a, b) => a + b, 0) / c.probabilities.length) * 10) /
          10
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
}

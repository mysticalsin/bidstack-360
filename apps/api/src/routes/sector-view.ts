// Sector / Industry view — Amaris presence by industry sector globally.
// Source: ABC sector classification as mirrored on company records (industry,
// country_code, employee_count). Sparse classification does NOT hide the view;
// it raises a data-quality warning instead (managers still need it to prep
// sector pitches — per the demo brief).
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';

const SectorCountry = z.object({
  countryCode: z.string(),
  accountCount: z.number().int().nonnegative(),
  fteVolume: z.number().int().nonnegative().nullable(),
});

const SectorAccount = z.object({
  id: z.string(),
  name: z.string(),
  domain: z.string().nullable(),
  countryCode: z.string(),
  employeeCount: z.number().int().nonnegative().nullable(),
  source: z.string(),
  confidence: z.number().min(0).max(1),
  updatedAt: z.string().datetime(),
});

const SectorCoverage = z.object({
  knownFteAccounts: z.number().int().nonnegative(),
  verifiedAccounts: z.number().int().nonnegative(),
  logoAccounts: z.number().int().nonnegative(),
});

const SectorRow = z.object({
  sector: z.string(),
  accountCount: z.number().int().nonnegative(),
  // Sum of known employee counts; null when no account in the sector has one.
  fteVolume: z.number().int().nonnegative().nullable(),
  coverage: SectorCoverage,
  countries: z.array(SectorCountry),
  accounts: z.array(SectorAccount),
});

const SectorViewResponse = z.object({
  generatedAt: z.string().datetime(),
  totalAccounts: z.number().int().nonnegative(),
  classifiedAccounts: z.number().int().nonnegative(),
  // True when too few accounts carry an ABC sector classification for the
  // numbers to be trusted — the UI shows a warning banner, never hides.
  dataQualityWarning: z.boolean(),
  sectors: z.array(SectorRow),
});

const DATA_QUALITY_FLOOR = 0.6;

export const sectorViewRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/sector-view',
    { schema: { response: { 200: SectorViewResponse } } },
    async (req) => {
      const orgId = req.auth.orgId;

      // Org-exact totals come from count() over the whole org; the breakdown
      // below works off a bounded sample. Run together (Promise.all) so the
      // counts and the sample are read close to the same moment — count() and
      // findMany can't share one $transaction array cleanly here.
      const [totalAccounts, classifiedTotal, sample] = await Promise.all([
        prisma.company.count({ where: { orgId, deletedAt: null } }),
        prisma.company.count({ where: { orgId, deletedAt: null, industry: { not: null } } }),
        prisma.company.findMany({
          where: { orgId, deletedAt: null },
          select: {
            id: true,
            name: true,
            domain: true,
            industry: true,
            countryCode: true,
            employeeCount: true,
            logoUrl: true,
            source: true,
            confidence: true,
            updatedAt: true,
          },
          // Self-imposed bound for the per-sector breakdown: a sector rollup
          // over the newest 1000 accounts is a strategic overview, not a ledger.
          // (query-guard only rejects fully-unbounded reads; this take is ours.)
          take: 1000,
          orderBy: { createdAt: 'desc' },
        }),
      ]);

      // The per-sector breakdown is computed over `sample`; the headline
      // totals (totalAccounts / classifiedTotal) are org-exact counts.
      const classified = sample.filter((r) => r.industry && r.industry.trim());
      const bySector = new Map<
        string,
        {
          accountCount: number;
          fte: number;
          fteKnown: boolean;
          knownFteAccounts: number;
          verifiedAccounts: number;
          logoAccounts: number;
          countries: Map<string, { accountCount: number; fte: number; fteKnown: boolean }>;
          accounts: Array<z.infer<typeof SectorAccount>>;
        }
      >();
      for (const row of classified) {
        const sector = row.industry!.trim();
        const entry =
          bySector.get(sector) ??
          ({
            accountCount: 0,
            fte: 0,
            fteKnown: false,
            knownFteAccounts: 0,
            verifiedAccounts: 0,
            logoAccounts: 0,
            countries: new Map(),
            accounts: [],
          } as NonNullable<ReturnType<typeof bySector.get>>);
        entry.accountCount += 1;
        if (row.employeeCount != null) {
          entry.fte += row.employeeCount;
          entry.fteKnown = true;
          entry.knownFteAccounts += 1;
        }
        if (row.source === 'verified_data') entry.verifiedAccounts += 1;
        if (row.logoUrl) entry.logoAccounts += 1;
        const cc = row.countryCode ?? '??';
        const country = entry.countries.get(cc) ?? { accountCount: 0, fte: 0, fteKnown: false };
        country.accountCount += 1;
        if (row.employeeCount != null) {
          country.fte += row.employeeCount;
          country.fteKnown = true;
        }
        entry.countries.set(cc, country);
        entry.accounts.push({
          id: row.id,
          name: row.name,
          domain: row.domain,
          countryCode: cc,
          employeeCount: row.employeeCount,
          source: row.source,
          confidence: row.confidence,
          updatedAt: row.updatedAt.toISOString(),
        });
        bySector.set(sector, entry);
      }

      const sectors = [...bySector.entries()]
        .map(([sector, entry]) => ({
          sector,
          accountCount: entry.accountCount,
          fteVolume: entry.fteKnown ? entry.fte : null,
          coverage: {
            knownFteAccounts: entry.knownFteAccounts,
            verifiedAccounts: entry.verifiedAccounts,
            logoAccounts: entry.logoAccounts,
          },
          countries: [...entry.countries.entries()]
            .map(([countryCode, c]) => ({
              countryCode,
              accountCount: c.accountCount,
              fteVolume: c.fteKnown ? c.fte : null,
            }))
            .sort((a, b) => b.accountCount - a.accountCount),
          accounts: entry.accounts
            .sort(
              (a, b) =>
                (b.employeeCount ?? -1) - (a.employeeCount ?? -1) || a.name.localeCompare(b.name),
            )
            .slice(0, 8),
        }))
        .sort((a, b) => b.accountCount - a.accountCount);

      return {
        generatedAt: new Date().toISOString(),
        totalAccounts,
        classifiedAccounts: classifiedTotal,
        dataQualityWarning:
          totalAccounts === 0 || classifiedTotal / totalAccounts < DATA_QUALITY_FLOOR,
        sectors,
      };
    },
  );
};

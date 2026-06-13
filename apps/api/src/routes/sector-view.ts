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

const SectorRow = z.object({
  sector: z.string(),
  accountCount: z.number().int().nonnegative(),
  // Sum of known employee counts; null when no account in the sector has one.
  fteVolume: z.number().int().nonnegative().nullable(),
  countries: z.array(SectorCountry),
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
      const rows = await prisma.company.findMany({
        where: { orgId: req.auth.orgId, deletedAt: null },
        select: { industry: true, countryCode: true, employeeCount: true },
        // Bounded read: query-guard caps take at 1000; a sector rollup over the
        // top 1000 accounts is a strategic overview, not a ledger.
        take: 1000,
        orderBy: { createdAt: 'desc' },
      });

      const totalAccounts = rows.length;
      const classified = rows.filter((r) => r.industry && r.industry.trim());
      const bySector = new Map<
        string,
        { accountCount: number; fte: number; fteKnown: boolean; countries: Map<string, { accountCount: number; fte: number; fteKnown: boolean }> }
      >();
      for (const row of classified) {
        const sector = row.industry!.trim();
        const entry =
          bySector.get(sector) ??
          ({ accountCount: 0, fte: 0, fteKnown: false, countries: new Map() } as NonNullable<
            ReturnType<typeof bySector.get>
          >);
        entry.accountCount += 1;
        if (row.employeeCount) {
          entry.fte += row.employeeCount;
          entry.fteKnown = true;
        }
        const cc = row.countryCode ?? '??';
        const country = entry.countries.get(cc) ?? { accountCount: 0, fte: 0, fteKnown: false };
        country.accountCount += 1;
        if (row.employeeCount) {
          country.fte += row.employeeCount;
          country.fteKnown = true;
        }
        entry.countries.set(cc, country);
        bySector.set(sector, entry);
      }

      const sectors = [...bySector.entries()]
        .map(([sector, entry]) => ({
          sector,
          accountCount: entry.accountCount,
          fteVolume: entry.fteKnown ? entry.fte : null,
          countries: [...entry.countries.entries()]
            .map(([countryCode, c]) => ({
              countryCode,
              accountCount: c.accountCount,
              fteVolume: c.fteKnown ? c.fte : null,
            }))
            .sort((a, b) => b.accountCount - a.accountCount),
        }))
        .sort((a, b) => b.accountCount - a.accountCount);

      return {
        generatedAt: new Date().toISOString(),
        totalAccounts,
        classifiedAccounts: classified.length,
        dataQualityWarning:
          totalAccounts === 0 || classified.length / totalAccounts < DATA_QUALITY_FLOOR,
        sectors,
      };
    },
  );
};

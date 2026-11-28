/**
 * Sample headquarters for demo accounts that already have fixture firmographics
 * and no offices. A stored location is left alone. Live rows are left alone.
 */
import { hostedFirmographicLocations } from '@bidstack/shared';

import type { Prisma, PrismaClient } from '../generated/client/index.js';

type SeedClient = Prisma.TransactionClient | PrismaClient;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

/** Write one sample headquarters onto each fixture firmographics row that has none. */
export async function seedCompanyLocations(prisma: SeedClient, orgId: string): Promise<number> {
  const companies = await prisma.company.findMany({
    where: { orgId, deletedAt: null },
    select: { id: true, name: true },
  });
  let written = 0;
  for (const company of companies) {
    const row = await prisma.companyFirmographics.findUnique({
      where: { companyId: company.id },
      select: { locations: true, provenance: true, fetchedAt: true },
    });
    if (!row) continue;
    const hosted = hostedFirmographicLocations({
      companyName: company.name,
      locations: row.locations,
      provenance: row.provenance,
      fetchedAt: (row.fetchedAt ?? new Date(0)).toISOString(),
    });
    if (!hosted.provenancePatch) continue;
    await prisma.companyFirmographics.update({
      where: { companyId: company.id },
      data: {
        locations: hosted.locations as Prisma.InputJsonValue,
        provenance: { ...record(row.provenance), ...hosted.provenancePatch } as Prisma.InputJsonValue,
      },
    });
    written++;
  }
  return written;
}

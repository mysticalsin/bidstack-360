import { SIGNING_ENTITY_CATALOG } from '@bidstack/shared';

import type { Prisma, PrismaClient } from '../generated/client/index.js';

type SeedClient = Prisma.TransactionClient | PrismaClient;

export async function seedSigningEntities(prisma: SeedClient, orgId: string): Promise<number> {
  let count = 0;
  for (const entry of SIGNING_ENTITY_CATALOG) {
    await prisma.signingEntity.upsert({
      where: { orgId_slug: { orgId, slug: entry.slug } },
      create: {
        orgId,
        slug: entry.slug,
        name: entry.name,
        legalName: entry.legalName,
        brandFamily: entry.brandFamily,
        aliases: [...entry.aliases],
        businessLines: [...entry.businessLines],
        sourceUrl: entry.sourceUrl,
        verificationStatus: entry.verificationStatus,
        notes: entry.notes,
      },
      update: {
        name: entry.name,
        legalName: entry.legalName,
        brandFamily: entry.brandFamily,
        aliases: [...entry.aliases],
        businessLines: [...entry.businessLines],
        sourceUrl: entry.sourceUrl,
        verificationStatus: entry.verificationStatus,
        notes: entry.notes,
      },
    });
    count += 1;
  }
  return count;
}

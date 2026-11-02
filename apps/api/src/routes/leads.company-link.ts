import { prisma } from '@bidstack/db';

/** One company id, null when the name is only a label, or ambiguous when several match. */
export async function resolveLeadCompanyId(
  orgId: string,
  companyName: string,
): Promise<string | null | 'ambiguous'> {
  const matches = await prisma.company.findMany({
    where: {
      orgId,
      deletedAt: null,
      name: { equals: companyName.trim(), mode: 'insensitive' },
    },
    select: { id: true },
    take: 2,
  });
  if (matches.length === 0) return null;
  if (matches.length > 1) return 'ambiguous';
  return matches[0]?.id ?? null;
}

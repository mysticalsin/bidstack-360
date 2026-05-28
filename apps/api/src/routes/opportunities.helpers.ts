/**
 * opportunities.helpers.ts — Pure utility functions shared by opportunity route handlers.
 *
 * WHY separate: mintNextCode and isUniqueViolation have no Fastify dependency
 * and are used from both the create and bulk-import handlers. Extracting them
 * here keeps the route files free of transaction/collision logic and allows
 * independent testing.
 *
 * Import DAG: no local sibling imports — leaf node.
 */
import { Prisma } from '@bidstack/db';

/**
 * Reads the highest existing OP-NNNN code inside the current transaction and
 * returns the next value. Unique violation on collision is caught by the
 * bounded retry loop in the caller.
 */
export async function mintNextCode(tx: Prisma.TransactionClient, orgId: string): Promise<string> {
  // Reads inside the active transaction so a concurrent create's row is
  // visible to whichever attempt wins. Unique violation on collision is
  // caught by the caller's bounded retry loop.
  const last = await tx.opportunity.findFirst({
    where: { orgId, code: { startsWith: 'OP-' }, deletedAt: null },
    orderBy: { code: 'desc' },
    select: { code: true },
  });
  if (!last) return 'OP-2001';
  const n = Number(last.code.slice(3));
  return `OP-${(n + 1).toString().padStart(4, '0')}`;
}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

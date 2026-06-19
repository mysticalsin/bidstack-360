/**
 * opportunities.helpers.ts - Pure utility functions shared by opportunity route handlers.
 *
 * WHY separate: mintNextCode and isUniqueViolation have no Fastify dependency
 * and are used from create, import, and lead conversion handlers.
 */
import { Prisma } from '@bidstack/db';

type MaxOpportunityCodeRow = {
  maxCode: number | bigint | null;
};

function formatOpportunityCode(n: number): string {
  return `OP-${n.toString().padStart(4, '0')}`;
}

async function readMaxOpportunityCodeNumber(
  tx: Prisma.TransactionClient,
  orgId: string,
): Promise<number> {
  // Numeric suffix ordering is required once the sequence reaches OP-10000.
  // Lexicographic DESC would keep OP-9999 above OP-10000 and repeatedly mint
  // a duplicate under concurrent create/import traffic.
  //
  // Do not filter deleted_at: the unique key is (org_id, code), so a
  // soft-deleted row still owns its code.
  const rows = await tx.$queryRaw<MaxOpportunityCodeRow[]>(Prisma.sql`
    SELECT MAX((substring(code FROM 4))::integer) AS "maxCode"
    FROM opportunities
    WHERE org_id = ${orgId}::uuid
      AND code ~ '^OP-[0-9]+$'
  `);
  const rawMax = rows[0]?.maxCode;
  if (rawMax === null || rawMax === undefined) return 2000;
  return typeof rawMax === 'bigint' ? Number(rawMax) : rawMax;
}

/**
 * Reads the highest existing numeric OP-* code inside the current transaction
 * and returns the next value. Unique violation on collision is caught by the
 * bounded retry loop in the caller.
 */
export async function mintNextCode(tx: Prisma.TransactionClient, orgId: string): Promise<string> {
  const codes = await mintNextCodes(tx, orgId, 1);
  return codes[0]!;
}

export async function mintNextCodes(
  tx: Prisma.TransactionClient,
  orgId: string,
  count: number,
): Promise<string[]> {
  if (count <= 0) return [];
  const start = (await readMaxOpportunityCodeNumber(tx, orgId)) + 1;
  return Array.from({ length: count }, (_, index) => formatOpportunityCode(start + index));
}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

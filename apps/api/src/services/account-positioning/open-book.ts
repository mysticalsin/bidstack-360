import { Prisma, prisma } from '@bidstack/db';

import { openTotalUnits } from './micros.js';

/** Signed int64. Postgres SUM(bigint) cannot return a total past this. */
export const INT64_MAX_MICROS = 9_223_372_036_854_775_807n;

export type OpenBook = {
  count: number;
  /** Null when the sum is too large to show. The count is still the book. */
  micros: bigint | null;
};

function wholeBigInt(total: string): bigint {
  const whole = total.trim().split('.')[0] ?? '0';
  return BigInt(whole);
}

/**
 * Open count and open micros for the whole book. The sum is numeric text so a
 * total past int64 comes back as "too large" instead of a Prisma P2023.
 * Lost wins. A deleted stage row does not close the deal.
 */
export async function readOpenBook(orgId: string, companyIds: readonly string[]): Promise<OpenBook> {
  if (companyIds.length === 0) return { count: 0, micros: 0n };
  const ids = Prisma.join(companyIds.map((id) => Prisma.sql`${id}::uuid`));
  const rows = await prisma.$queryRaw<Array<{ n: bigint; total: string | null }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS n,
           SUM(o.value_micros::numeric)::text AS total
    FROM opportunities o
    LEFT JOIN pipeline_stages ps ON ps.id = o.pipeline_stage_id
    WHERE o.org_id = ${orgId}::uuid
      AND o.company_id IN (${ids})
      AND o.deleted_at IS NULL
      AND NOT (
        o.stage::text = 'closed_lost'
        OR (ps.id IS NOT NULL AND ps.deleted_at IS NULL AND ps.is_lost)
        OR o.stage::text = 'closed_won'
        OR (ps.id IS NOT NULL AND ps.deleted_at IS NULL AND ps.is_won)
      )
  `);
  const row = rows[0];
  const count = Number(row?.n ?? 0n);
  if (count === 0 || row?.total == null) return { count, micros: 0n };
  const micros = wholeBigInt(row.total);
  if (micros > INT64_MAX_MICROS || micros < -INT64_MAX_MICROS || openTotalUnits(micros) == null) {
    return { count, micros: null };
  }
  return { count, micros };
}

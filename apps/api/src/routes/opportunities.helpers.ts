/**
 * opportunities.helpers.ts - Pure utility functions shared by opportunity route handlers.
 *
 * WHY separate: mintNextCode and isUniqueViolation have no Fastify dependency
 * and are used from create, import, and lead conversion handlers.
 */
import { Prisma } from '@bidstack/db';
import { normalizeName } from '@bidstack/shared';

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

/**
 * Builds a normalizedName → Company.id index for an org (one query).
 *
 * WHY in code, not SQL: Company has no `normalizedName` column, so the
 * customer→Company join is computed via the shared `normalizeName` (the single
 * source of truth used by the seed, worker, and CRM cockpit). Used by the
 * import path to resolve all rows from a single fetch instead of N+1.
 */
export async function loadCompanyNameIndex(
  db: Prisma.TransactionClient,
  orgId: string,
): Promise<Map<string, string>> {
  // Build the full normalizedName -> id index in BOUNDED pages. A single
  // unbounded findMany here is both a 100k-scale memory hazard and — because
  // every request runs under the query-guard (plugins/query-guard.ts) — gets
  // rejected with a 400, which silently broke BOTH lead-convert and CSV import
  // (each resolves a free-text customer -> Company through this index). Cursor
  // pagination keeps every query <= PAGE (guard-safe: take <= 1000) while still
  // producing the complete index callers depend on.
  const PAGE = 1000;
  const index = new Map<string, string>();
  let cursor: string | undefined;
  for (;;) {
    const page = await db.company.findMany({
      where: { orgId, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { id: 'asc' },
      take: PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const c of page) {
      const key = normalizeName(c.name);
      // First match wins so re-runs are stable when two names normalize alike.
      if (key && !index.has(key)) index.set(key, c.id);
    }
    if (page.length < PAGE) break;
    cursor = page[page.length - 1]!.id;
  }
  return index;
}

/**
 * Resolves a free-text customer string to an EXISTING Company id within the org
 * by normalized name. Link-only: returns null when no Company matches — it never
 * creates a Company from free text (that would pollute the account rollups with
 * duplicates). Keeps `opportunity.companyId` consistent with `customer` so the
 * /accounts and cockpit rollups (which group by companyId) stay correct.
 */
export async function resolveCompanyIdByName(
  db: Prisma.TransactionClient,
  orgId: string,
  customer: string | null | undefined,
): Promise<string | null> {
  if (!customer) return null;
  const key = normalizeName(customer);
  if (!key) return null;
  const index = await loadCompanyNameIndex(db, orgId);
  return index.get(key) ?? null;
}

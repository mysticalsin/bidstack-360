// DB-backed regression for the ai-audit retention purge guard.
//
// WHY this cannot be a unit test: the defect was a Postgres/Prisma type
// mismatch. `SELECT to_regclass('ai_invocations')` returns Postgres type
// `regclass`, which the Prisma engine refuses to deserialize — so the guard
// meant to make the nightly purge safe threw on EVERY run and the 90-day
// retention never executed. A mocked $queryRaw returns whatever the mock says
// and reproduces none of that; only a real connection proves the cast.
import { prisma } from '@bidstack/db';
import { beforeAll, describe, expect, it } from 'vitest';

let dbReachable = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
  }
}, 30_000);

// Fail loud rather than silently pass when Postgres is down (repo Rule 12).
const t = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbReachable) throw new Error(`[skip] ${name} — DATABASE_URL not reachable`);
    await fn();
  });

describe('ai-audit retention: table-existence guard', () => {
  t('deserializes to_regclass when cast to text', async () => {
    const rows = await prisma.$queryRaw<Array<{ reg: string | null }>>`
      SELECT to_regclass('ai_invocations')::text AS reg
    `;
    expect(rows[0]?.reg).toBe('ai_invocations');
  });

  t('returns null for a missing table so the guard still short-circuits', async () => {
    // The cast must not turn "absent" into a truthy string, or the purge would
    // run DELETEs against a table that does not exist.
    const rows = await prisma.$queryRaw<Array<{ reg: string | null }>>`
      SELECT to_regclass('definitely_not_a_real_table_xyz')::text AS reg
    `;
    expect(rows[0]?.reg).toBeNull();
  });

  t('throws without the cast — the exact defect this pins', async () => {
    // Documents WHY ::text is in the query. If a future edit drops the cast,
    // the purge silently stops running; this makes that a failing test instead.
    await expect(
      prisma.$queryRaw`SELECT to_regclass('ai_invocations') AS reg`,
    ).rejects.toThrow(/deserialize column of type 'regclass'/i);
  });
});

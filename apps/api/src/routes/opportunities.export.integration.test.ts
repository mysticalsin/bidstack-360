// Integration tests for GET /api/opportunities/export (streaming CSV).
//
// Regression coverage for three defects that shipped in opportunities.export.ts:
//
//  1. RBAC/M7 (BLOCKER): the export never applied the row-level access scope,
//     so a country-restricted user could download the ENTIRE org pipeline even
//     though the list/detail routes hide out-of-scope rows. WHY it matters: the
//     CSV is the highest-leverage exfiltration surface — one request dumps every
//     deal's name/customer/value/owner across every country.
//
//  2. Cursor pagination (MAJOR): the export ordered by the non-unique
//     `updatedAt` column with a bare `cursor:{id}` — Prisma cannot tell an
//     already-returned tied row from a not-yet-returned one, so rows sharing an
//     updatedAt at a BATCH_SIZE boundary are dropped/duplicated. WHY it matters:
//     a "complete pipeline dump" that silently omits rows corrupts reporting and
//     compliance exports. Fixed with the compound (updatedAt, id) tiebreaker.
//
//  3. Money precision (MINOR): the export formatted micros with
//     `Number(bigint)/1e6`, which rounds the BigInt->Number conversion BEFORE
//     dividing and corrupts any value above ~Number.MAX_SAFE_INTEGER micros.
//     WHY it matters: a mega-bid's value must be exact to the cent in an export.
//
// The stub-auth identity is the isolated org's (unrestricted) admin user with
// zero group memberships; the scope test TRANSIENTLY joins it to an FR-only
// group to prove the gate, then restores.
import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import { invalidateAccessScope } from '../lib/access-scope.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let stubUserId: string | null = null;
let restoreAuth: (() => void) | null = null;

const TAG = `export-${Date.now()}`;

// Straddle the BATCH_SIZE (250) boundary with a tie block. 240 rows carry
// strictly-decreasing, far-future (year 2099) timestamps so they occupy the
// first 240 ordered positions; 20 rows all share one identical, slightly-older
// (year 2098) timestamp so they occupy positions 241..260 — the batch boundary
// at 250 falls strictly INSIDE this tied block. Without an `id` tiebreaker,
// page 1 emits 10 of the tied rows and page 2 (cursor keyed on the non-unique
// updatedAt) re-emits 19 of the 20 — 29 emissions for 20 rows, so at least one
// row is duplicated (pigeonhole), breaking the "exactly once" assertion. With
// the compound (updatedAt, id) order the walk is deterministic and every row
// appears exactly once.
const DISTINCT_COUNT = 240;
const TIE_COUNT = 20;
const distinctCodes = Array.from(
  { length: DISTINCT_COUNT },
  (_, i) => `PAGE-DIST-${String(i).padStart(3, '0')}`,
);
const tieCodes = Array.from(
  { length: TIE_COUNT },
  (_, i) => `PAGE-TIE-${String(i).padStart(3, '0')}`,
);
const allPageCodes = [...distinctCodes, ...tieCodes];

// A value chosen so the naive `Number(bigint)/1e6` rounds to a DIFFERENT cent
// than the BigInt-safe `microsToUnits`: naive -> 8598204328457.19, safe ->
// 8598204328457.18. Fits Postgres int8 (< 9.22e18). If formatMicros regresses
// to the naive form this test fails on the wrong cent.
const MONEY_CODE = 'MONEY-BIG';
const MONEY_MICROS = 8_598_204_328_457_184_962n;
const MONEY_EXPECTED_CENTS = '8598204328457.18';
const MONEY_NAIVE_WRONG = '8598204328457.19';

const SCOPE_FR_CODE = 'SCOPE-FR';
const SCOPE_DE_CODE = 'SCOPE-DE';

async function fetchExportCsv(): Promise<string> {
  const res = await server.inject({ method: 'GET', url: '/api/opportunities/export' });
  expect(res.statusCode).toBe(200);
  return res.body;
}

// Map first CSV cell (Code) -> full split cells. Test fixtures use comma-free
// codes/names, so a naive split is sufficient to locate and read our own rows.
function csvCodeCounts(csv: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of csv.split('\r\n')) {
    if (!line) continue;
    const code = line.split(',')[0];
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return counts;
}

function csvRowCells(csv: string, code: string): string[] | null {
  for (const line of csv.split('\r\n')) {
    if (line.startsWith(`${code},`)) return line.split(',');
  }
  return null;
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const org = await createIsolatedOrg('opportunity-export');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  const user = await prisma.user.findFirst({ where: { orgId }, orderBy: { createdAt: 'asc' } });
  stubUserId = user?.id ?? null;
  if (!stubUserId) return;

  // Bulk-create pagination fixtures (ownerId null so the owner-visibility rule
  // can't leak scoped rows), the large-money row, and the two scope rows.
  await prisma.opportunity.createMany({
    data: [
      ...allPageCodes.map((code) => ({
        orgId: orgId!,
        code,
        customer: 'PageCo',
        name: `Page ${code}`,
        stage: 's1_lead' as const,
        ownerId: null,
      })),
      {
        orgId,
        code: MONEY_CODE,
        customer: 'MoneyCo',
        name: 'Mega bid',
        stage: 's1_lead' as const,
        valueMicros: MONEY_MICROS,
        ownerId: null,
      },
      {
        orgId,
        code: SCOPE_FR_CODE,
        customer: 'ScopeCo',
        name: 'FR deal',
        stage: 's1_lead' as const,
        country: 'FR',
        ownerId: null,
      },
      {
        orgId,
        code: SCOPE_DE_CODE,
        customer: 'ScopeCo',
        name: 'DE deal',
        stage: 's1_lead' as const,
        country: 'DE',
        ownerId: null,
      },
    ],
  });

  // updatedAt is `@updatedAt` (Prisma manages it on write and ignores provided
  // values), so the tie/ordering timestamps must be set via raw SQL. Distinct
  // rows get 2099 minus their numeric suffix in seconds; tie rows all share one
  // 2098 instant.
  await prisma.$executeRaw`
    UPDATE opportunities
       SET updated_at = TIMESTAMPTZ '2099-01-01 00:00:00+00' - (RIGHT(code, 3)::int) * INTERVAL '1 second'
     WHERE org_id = ${orgId}::uuid AND code LIKE 'PAGE-DIST-%'`;
  await prisma.$executeRaw`
    UPDATE opportunities
       SET updated_at = TIMESTAMPTZ '2098-01-01 00:00:00+00'
     WHERE org_id = ${orgId}::uuid AND code LIKE 'PAGE-TIE-%'`;

  server = await buildServer();
  await server.ready();
}, 120_000);

afterAll(async () => {
  if (server) await server.close();
  if (restoreAuth) restoreAuth();
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
});

const t = makeSkipIfNoDb(() => dbReachable && !!orgId && !!stubUserId);

describe('GET /opportunities/export', () => {
  t('exports the large-micros money value exact to the cent (no BigInt->Number rounding)', async () => {
    const csv = await fetchExportCsv();
    const cells = csvRowCells(csv, MONEY_CODE);
    expect(cells).not.toBeNull();
    // Column order: Code, Name, Customer, Stage, Value (EUR), ...
    const valueCell = cells![4];
    expect(valueCell).toBe(MONEY_EXPECTED_CENTS);
    // Guard the exact regression: the naive Number(bigint)/1e6 form would emit
    // this wrong cent.
    expect(valueCell).not.toBe(MONEY_NAIVE_WRONG);
  });

  t('emits every tie-straddling row exactly once across the batch boundary', async () => {
    const csv = await fetchExportCsv();
    const counts = csvCodeCounts(csv);
    // Every seeded PAGE code must appear exactly once — no drops, no duplicates.
    for (const code of allPageCodes) {
      expect(counts.get(code) ?? 0).toBe(1);
    }
  });

  t('a country-scoped user\'s export excludes out-of-scope rows', async () => {
    // Transiently join the (previously unrestricted) stub user to an FR-only
    // access group, then restore in finally so later runs are unaffected.
    const group = await prisma.userGroup.create({
      data: { orgId: orgId!, name: `${TAG}-grp`, scopeCountries: ['FR'], scopeAll: false },
    });
    await prisma.userGroupMember.create({
      data: { orgId: orgId!, userId: stubUserId!, groupId: group.id },
    });
    invalidateAccessScope(orgId!, stubUserId!);
    try {
      const csv = await fetchExportCsv();
      const counts = csvCodeCounts(csv);
      // FR is in scope; DE is not (both owned by nobody, so the owner rule can't
      // leak the DE row). The unscoped export would have contained both.
      expect(counts.get(SCOPE_FR_CODE) ?? 0).toBe(1);
      expect(counts.get(SCOPE_DE_CODE) ?? 0).toBe(0);
    } finally {
      await prisma.userGroupMember.deleteMany({
        where: { orgId: orgId!, userId: stubUserId!, groupId: group.id },
      });
      await prisma.userGroup.deleteMany({ where: { id: group.id } });
      invalidateAccessScope(orgId!, stubUserId!);
    }
  });
});

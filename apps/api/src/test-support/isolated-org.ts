// Per-file test isolation primitive.
//
// WHY: every route integration test historically resolved ONE shared seed org
// (`org_seed_mantu`). Tests mutate that org's data + RBAC and clean up only
// best-effort, so heavy/back-to-back runs corrupt the shared org (mass 403),
// leave orphan rows (unique-constraint 409s), and make the suite
// non-deterministic. A throwaway, fully-seeded org per file removes the shared
// surface entirely — two files (or two runs) can never collide because each
// gets a globally-unique `clerkOrg`.
//
// Auth wiring: stub auth (apps/api/src/plugins/auth.ts) resolves its org from
// `BIDSTACK_STUB_ORG_CLERK` when set (dev/test + loopback only). A suite points
// that env at its isolated org in beforeAll and restores it in afterAll;
// fileParallelism is off (vitest.config.ts) so the process-global env is
// race-free across files.

import { randomUUID } from 'node:crypto';

import { prisma, seedOrgData } from '@bidstack/db';

const STUB_ORG_ENV = 'BIDSTACK_STUB_ORG_CLERK';

export interface IsolatedOrg {
  orgId: string;
  clerkOrg: string;
  namespace: string;
}

/**
 * Create a throwaway org seeded with the full demo dataset (Admin visitor +
 * teammates with RBAC grants, companies, opps, proposals, contacts, leads,
 * tasks). The visitor is created first, so stub auth's `findFirst orderBy
 * createdAt asc` resolves to an Admin — permission gates pass out of the box.
 */
export async function createIsolatedOrg(label = 'test'): Promise<IsolatedOrg> {
  const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const clerkOrg = `org_${label}_${ns}`;
  const org = await prisma.org.create({
    data: { clerkOrg, name: `Test Org ${label} ${ns}` },
  });
  await seedOrgData(prisma, org.id, {
    ownerEmail: `admin.${ns}@test.local`,
    ownerName: 'Test Admin',
    namespace: ns,
  });
  return { orgId: org.id, clerkOrg, namespace: ns };
}

/**
 * Point stub auth at the isolated org for the rest of this file. Returns a
 * restore fn for afterAll. Safe because suites run serially (fileParallelism
 * off) — no two files race on the process env.
 */
export function useIsolatedOrgAuth(clerkOrg: string): () => void {
  const previous = process.env[STUB_ORG_ENV];
  process.env[STUB_ORG_ENV] = clerkOrg;
  return () => {
    if (previous === undefined) delete process.env[STUB_ORG_ENV];
    else process.env[STUB_ORG_ENV] = previous;
  };
}

/**
 * Best-effort teardown. Isolation correctness does NOT depend on this: the
 * unique clerkOrg already prevents cross-org pollution. Cascade-deletes the org
 * when the schema allows; otherwise the throwaway org is left for a test-DB
 * reset to reclaim (kept out of the way, never reused).
 */
export async function dropIsolatedOrg(orgId: string): Promise<void> {
  try {
    await prisma.org.delete({ where: { id: orgId } });
  } catch {
    /* leave it — a fresh test DB or periodic sweep reclaims throwaway orgs */
  }
}

// Concurrent parent edits must not form a cycle.
//
// The hierarchy walk used to run before the write, with no lock. Two admins
// can each see an acyclic graph and then point the companies at each other.
// parentId has no database acyclicity constraint, and the hierarchy reader
// only stops walking once it notices the cycle. One of the two writes has to
// lose.

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let restoreAuth: (() => void) | null = null;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const org = await createIsolatedOrg('company-cycle');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  server = await buildServer();
  await server.ready();
}, 120_000);

afterAll(async () => {
  if (server) await server.close();
  if (restoreAuth) restoreAuth();
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!orgId);

function parentCycle(rows: Array<{ id: string; parentId: string | null }>): boolean {
  const parentOf = new Map(rows.map((row) => [row.id, row.parentId]));
  for (const start of parentOf.keys()) {
    const seen = new Set<string>();
    let current: string | null = start;
    while (current) {
      if (seen.has(current)) return true;
      seen.add(current);
      current = parentOf.get(current) ?? null;
    }
  }
  return false;
}

describe('company parent concurrency', () => {
  skipIfNoDb(
    'parallel parent edits cannot point two companies at each other',
    async () => {
      const suffix = randomUUID().slice(0, 8);
      const [a, b] = await Promise.all([
        prisma.company.create({ data: { orgId: orgId!, name: `Cycle A ${suffix}` } }),
        prisma.company.create({ data: { orgId: orgId!, name: `Cycle B ${suffix}` } }),
      ]);

      const [left, right] = await Promise.all([
        server.inject({
          method: 'PATCH',
          url: `/api/companies/${a.id}`,
          payload: { parentId: b.id },
        }),
        server.inject({
          method: 'PATCH',
          url: `/api/companies/${b.id}`,
          payload: { parentId: a.id },
        }),
      ]);

      const stored = await prisma.company.findMany({
        where: { id: { in: [a.id, b.id] } },
        select: { id: true, parentId: true },
      });
      const statuses = [left.statusCode, right.statusCode].sort((x, y) => x - y);

      expect(parentCycle(stored)).toBe(false);
      expect(statuses).toEqual([200, 400]);
      expect([left.json(), right.json()].some((body) => body.message === 'Circular reference detected')).toBe(
        true,
      );
    },
  );
});

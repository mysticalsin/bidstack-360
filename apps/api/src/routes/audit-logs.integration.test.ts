// Integration tests for GET /api/audit-logs (admin section review).
// Covers happy path, validation 400, RBAC 403, tenant isolation and
// pagination bounds. The route is read-only, so there is no write retry.

import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  type IsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let org: IsolatedOrg | null = null;
let otherOrg: IsolatedOrg | null = null;
let restoreAuth: (() => void) | undefined;
let previousStubRoleHeader: string | undefined;

beforeAll(async () => {
  previousStubRoleHeader = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  org = await createIsolatedOrg('audit-read');
  otherOrg = await createIsolatedOrg('audit-read-other');
  await prisma.auditLog.createMany({
    data: [
      ...Array.from({ length: 5 }, (_, i) => ({
        orgId: org!.orgId,
        action: `review.own.${i}`,
        targetType: 'workflow',
      })),
      { orgId: otherOrg.orgId, action: 'review.foreign', targetType: 'workflow' },
    ],
  });
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  server = await buildServer();
  await server.ready();
}, 120_000);

afterAll(async () => {
  if (server) await server.close();
  restoreAuth?.();
  if (org) await dropIsolatedOrg(org.orgId);
  if (otherOrg) await dropIsolatedOrg(otherOrg.orgId);
  if (dbReachable) await prisma.$disconnect();
  if (previousStubRoleHeader === undefined) delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  else process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previousStubRoleHeader;
}, 60_000);

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!org);

type Page = { items: { id: string; action: string }[]; nextCursor: string | null };

const list = (query = '', role?: string) =>
  server.inject({
    method: 'GET',
    url: `/api/audit-logs${query}`,
    headers: role ? { 'x-bidstack-e2e-role': role } : {},
  });

describe('audit log read route', () => {
  skipIfNoDb('lists only this org rows and pages with a cursor', async () => {
    const first = await list('?limit=3&action=review.');
    expect(first.statusCode).toBe(200);
    const page1 = first.json() as Page;
    expect(page1.items).toHaveLength(3);
    expect(page1.nextCursor).not.toBeNull();

    const second = await list(`?limit=3&action=review.&cursor=${page1.nextCursor}`);
    const page2 = second.json() as Page;
    const all = [...page1.items, ...page2.items].map((r) => r.action);
    expect(new Set(all).size).toBe(all.length);
    expect(all.filter((a) => a.startsWith('review.own.'))).toHaveLength(5);
    expect(all).not.toContain('review.foreign');
  });

  skipIfNoDb('rejects bad filters with 400', async () => {
    for (const q of ['?limit=0', '?limit=201', '?limit=abc', '?cursor=abc', '?cursor=-5']) {
      const res = await list(q);
      expect(res.statusCode, q).toBe(400);
    }
  });

  skipIfNoDb('a cursor past the int8 range is a 400, not a 500', async () => {
    const res = await list('?cursor=99999999999999999999999');
    expect(res.statusCode).toBe(400);
  });

  skipIfNoDb('enforces RBAC: an SDR cannot read the audit log', async () => {
    const res = await list('', 'sdr');
    expect(res.statusCode).toBe(403);
  });
});

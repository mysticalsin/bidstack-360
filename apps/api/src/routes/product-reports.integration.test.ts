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
let isolatedOrg: IsolatedOrg | null = null;
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
  isolatedOrg = await createIsolatedOrg('productreports');
  restoreAuth = useIsolatedOrgAuth(isolatedOrg.clerkOrg);
  server = await buildServer();
  await server.ready();
}, 30_000);

afterAll(async () => {
  if (server) await server.close();
  restoreAuth?.();
  if (isolatedOrg) await dropIsolatedOrg(isolatedOrg.orgId);
  if (dbReachable) await prisma.$disconnect();
  if (previousStubRoleHeader === undefined) {
    delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  } else {
    process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previousStubRoleHeader;
  }
}, 30_000);

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!isolatedOrg);

function clientLog(route: string) {
  return {
    route,
    build: 'test',
    browser: 'vitest',
    timestamp: new Date().toISOString(),
  };
}

describe('product reports', () => {
  skipIfNoDb(
    'a bug and a feature request persist for admins, and the same crash is stored once',
    async () => {
      const bug = await server.inject({
        method: 'POST',
        url: '/api/v1/product-reports',
        payload: {
          kind: 'bug',
          whatDoing: 'Saving a bid score',
          steps: 'Open the bid and click save',
          page: '/opportunities/42',
          clientLog: clientLog('/opportunities/42'),
        },
      });
      expect(bug.statusCode).toBe(200);
      expect(bug.json()).toMatchObject({ ok: true, duplicate: false });

      const feature = await server.inject({
        method: 'POST',
        url: '/api/v1/product-reports',
        payload: {
          kind: 'feature',
          featureIntent: 'improved',
          whatDoing: 'Filtering the pipeline by owner',
          page: '/pipeline',
          clientLog: clientLog('/pipeline'),
        },
      });
      expect(feature.statusCode).toBe(200);

      const missingIntent = await server.inject({
        method: 'POST',
        url: '/api/v1/product-reports',
        payload: {
          kind: 'feature',
          whatDoing: 'A feature with no intent',
          page: '/pipeline',
          clientLog: clientLog('/pipeline'),
        },
      });
      expect(missingIntent.statusCode).toBe(400);

      const crash = await server.inject({
        method: 'POST',
        url: '/api/v1/product-reports',
        payload: {
          kind: 'crash',
          whatDoing: 'Cannot read properties of undefined',
          page: '/dashboard',
          clientLog: {
            ...clientLog('/dashboard'),
            recentActions: ['Opened /dashboard'],
          },
          error: 'Cannot read properties of undefined',
          stack: 'at Dashboard',
          signature: 'abc12345',
        },
      });
      expect(crash.statusCode).toBe(200);
      const crashId = crash.json().id as string;

      const repeat = await server.inject({
        method: 'POST',
        url: '/api/v1/product-reports',
        payload: {
          kind: 'crash',
          whatDoing: 'Cannot read properties of undefined',
          page: '/dashboard',
          clientLog: clientLog('/dashboard'),
          error: 'Cannot read properties of undefined',
          stack: 'at Dashboard',
          signature: 'abc12345',
        },
      });
      expect(repeat.statusCode).toBe(200);
      expect(repeat.json()).toEqual({ ok: true, duplicate: true, id: crashId });

      const list = await server.inject({ method: 'GET', url: '/api/v1/product-reports' });
      expect(list.statusCode).toBe(200);
      const items = list.json().items as Array<{
        kind: string;
        whatDoing: string;
        featureIntent: string | null;
      }>;

      // WHY: both kinds of request have to be waiting for an admin, and a
      // repeated crash signature must not become a second incident.
      expect(items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'bug', whatDoing: 'Saving a bid score' }),
          expect.objectContaining({
            kind: 'feature',
            featureIntent: 'improved',
            whatDoing: 'Filtering the pipeline by owner',
          }),
        ]),
      );
      expect(items.filter((item) => item.kind === 'crash')).toHaveLength(1);

      const rows = await prisma.auditLog.findMany({
        where: {
          orgId: isolatedOrg!.orgId,
          targetType: 'product_report',
          action: { in: ['product_report.bug', 'product_report.feature', 'product_report.crash'] },
        },
        select: { action: true },
      });
      expect(rows.map((row) => row.action).sort()).toEqual([
        'product_report.bug',
        'product_report.crash',
        'product_report.feature',
      ]);

      const denied = await server.inject({
        method: 'GET',
        url: '/api/v1/product-reports',
        headers: { 'x-bidstack-e2e-role': 'viewer' },
      });
      expect(denied.statusCode).toBe(403);
    },
  );
});

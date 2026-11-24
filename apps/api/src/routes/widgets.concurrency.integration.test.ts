// Two editors saving a widget from the same loaded version must not drop
// each other's fields. The write replaces the whole config (analytics) or the
// whole layout row (CRM). Without the version the client loaded, the slower
// save puts the stale document back.

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
  const org = await createIsolatedOrg('widget-race');
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

describe('widget edit concurrency', () => {
  skipIfNoDb(
    'parallel analytics config saves from one version keep the first and reject the second',
    async () => {
      const dash = await server.inject({
        method: 'POST',
        url: '/api/dashboards',
        payload: { name: `Board ${randomUUID().slice(0, 8)}` },
      });
      expect(dash.statusCode).toBe(201);
      const dashboardId = (dash.json() as { id: string }).id;
      const created = await server.inject({
        method: 'POST',
        url: `/api/dashboards/${dashboardId}/widgets`,
        payload: {
          title: 'Pipeline',
          type: 'kpi',
          config: { a: 1, b: 1 },
          position: { x: 0, y: 0, w: 2, h: 2 },
        },
      });
      expect(created.statusCode).toBe(201);
      const widget = created.json() as { id: string; updatedAt: string };
      const seen = widget.updatedAt;

      const [titleSave, configSave] = await Promise.all([
        server.inject({
          method: 'PATCH',
          url: `/api/dashboards/${dashboardId}/widgets/${widget.id}`,
          payload: { config: { a: 2, b: 1 }, expectedUpdatedAt: seen },
        }),
        server.inject({
          method: 'PATCH',
          url: `/api/dashboards/${dashboardId}/widgets/${widget.id}`,
          payload: { config: { a: 1, b: 2 }, expectedUpdatedAt: seen },
        }),
      ]);

      const statuses = [titleSave.statusCode, configSave.statusCode].sort((x, y) => x - y);
      expect(statuses).toEqual([200, 409]);
      const stored = await prisma.analyticsDashboardWidget.findFirstOrThrow({
        where: { id: widget.id, orgId: orgId! },
      });
      const winner = titleSave.statusCode === 200 ? { a: 2, b: 1 } : { a: 1, b: 2 };
      expect(stored.config).toEqual(winner);
    },
  );

  skipIfNoDb(
    'parallel CRM layout saves from one version keep the first and reject the second',
    async () => {
      const seeded = await server.inject({
        method: 'PATCH',
        url: '/api/crm/widgets',
        payload: {
          widgets: [
            {
              id: 'local',
              kind: 'provider_health',
              title: 'Health',
              x: 0,
              y: 0,
              w: 2,
              h: 2,
              config: { compact: false },
            },
          ],
        },
      });
      expect(seeded.statusCode).toBe(200);
      const row = await prisma.dashboardWidget.findUniqueOrThrow({
        where: { orgId_kind: { orgId: orgId!, kind: 'provider_health' } },
      });
      const seen = row.updatedAt.toISOString();
      const base = {
        id: row.id,
        kind: 'provider_health' as const,
        title: 'Health',
        x: 0,
        y: 0,
        w: 2,
        h: 2,
        config: { compact: false },
        expectedUpdatedAt: seen,
      };

      const [renamed, moved] = await Promise.all([
        server.inject({
          method: 'PATCH',
          url: '/api/crm/widgets',
          payload: { widgets: [{ ...base, title: 'Provider health' }] },
        }),
        server.inject({
          method: 'PATCH',
          url: '/api/crm/widgets',
          payload: { widgets: [{ ...base, x: 4 }] },
        }),
      ]);

      const statuses = [renamed.statusCode, moved.statusCode].sort((a, b) => a - b);
      expect(statuses).toEqual([200, 409]);
      const stored = await prisma.dashboardWidget.findUniqueOrThrow({
        where: { orgId_kind: { orgId: orgId!, kind: 'provider_health' } },
      });
      if (renamed.statusCode === 200) {
        expect(stored.title).toBe('Provider health');
        expect(stored.x).toBe(0);
      } else {
        expect(stored.title).toBe('Health');
        expect(stored.x).toBe(4);
      }
    },
  );
});

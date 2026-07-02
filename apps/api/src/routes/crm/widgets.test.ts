import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../../test-support/skip-if-no-db.js';

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
  const iso = await createIsolatedOrg('crm-widgets');
  orgId = iso.orgId;
  restoreAuth = useIsolatedOrgAuth(iso.clerkOrg);

  await prisma.dashboardWidget.deleteMany({
    where: { orgId, kind: 'provider_health' },
  });

  server = await buildServer();
  await server.ready();
}, 30_000);

afterAll(async () => {
  if (orgId) {
    await prisma.dashboardWidget.deleteMany({
      where: { orgId, kind: 'provider_health' },
    });
  }
  restoreAuth?.();
  if (server) await server.close();
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!orgId);

describe('crm widgets routes', () => {
  skipIfNoDb('PATCH /api/crm/widgets persists widget layout by kind', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: '/api/crm/widgets',
      payload: {
        widgets: [
          {
            id: 'provider-health-local',
            kind: 'provider_health',
            title: 'Provider Health',
            x: 2,
            y: 4,
            w: 3,
            h: 2,
            config: { compact: true },
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().widgets[0]).toMatchObject({
      kind: 'provider_health',
      x: 2,
      y: 4,
      w: 3,
      h: 2,
    });

    const row = await prisma.dashboardWidget.findUnique({
      where: { orgId_kind: { orgId: orgId!, kind: 'provider_health' } },
    });
    expect(row?.title).toBe('Provider Health');
    expect(row?.config).toMatchObject({ compact: true });
  });

  skipIfNoDb('PATCH /api/crm/widgets rejects invalid payload', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: '/api/crm/widgets',
      payload: {
        widgets: [
          {
            // missing required fields like kind
            id: 'bad-widget',
            title: 'Bad',
          },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  skipIfNoDb('PATCH /api/crm/widgets updates existing widget', async () => {
    // First create
    await server.inject({
      method: 'PATCH',
      url: '/api/crm/widgets',
      payload: {
        widgets: [
          {
            id: 'provider-health-local',
            kind: 'provider_health',
            title: 'Provider Health',
            x: 2,
            y: 4,
            w: 3,
            h: 2,
            config: { compact: true },
          },
        ],
      },
    });

    // Then update
    const res = await server.inject({
      method: 'PATCH',
      url: '/api/crm/widgets',
      payload: {
        widgets: [
          {
            id: 'provider-health-local',
            kind: 'provider_health',
            title: 'Provider Health Updated',
            x: 0,
            y: 0,
            w: 6,
            h: 4,
            config: { compact: false },
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().widgets[0].title).toBe('Provider Health Updated');
    expect(res.json().widgets[0].x).toBe(0);

    const row = await prisma.dashboardWidget.findUnique({
      where: { orgId_kind: { orgId: orgId!, kind: 'provider_health' } },
    });
    expect(row?.title).toBe('Provider Health Updated');
    expect(row?.config).toMatchObject({ compact: false });
  });
});

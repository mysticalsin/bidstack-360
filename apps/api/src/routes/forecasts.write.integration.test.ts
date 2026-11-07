// Forecast saves are keyed on (org, owner, period, category); a double-clicked
// save and a re-entry after delete must both land on that one row.
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
  const org = await createIsolatedOrg('forecasts-write');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  server = await buildServer();
  await server.ready();
}, 120_000);

afterAll(async () => {
  if (!dbReachable) return;
  await server?.close();
  restoreAuth?.();
  if (orgId) await dropIsolatedOrg(orgId);
});

const t = makeSkipIfNoDb(() => dbReachable);

describe('POST /api/forecasts', () => {
  t('concurrent saves of one cell all succeed and leave one row', async () => {
    const payload = { period: '2031-Q1', category: 'commit', amountMicros: 5_000_000 };
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        server.inject({ method: 'POST', url: '/api/forecasts', payload }),
      ),
    );
    expect(results.map((r) => r.statusCode)).toEqual(results.map(() => 201));
    expect(await prisma.forecast.count({ where: { orgId: orgId!, period: '2031-Q1' } })).toBe(1);
  });

  t('a cell can be entered again after its row was deleted', async () => {
    const payload = { period: '2031-Q2', category: 'pipeline', amountMicros: 1_000_000 };
    const first = await server.inject({ method: 'POST', url: '/api/forecasts', payload });
    expect(first.statusCode, first.body).toBe(201);
    const del = await server.inject({ method: 'DELETE', url: `/api/forecasts/${first.json().id}` });
    expect(del.statusCode, del.body).toBe(200);

    const again = await server.inject({
      method: 'POST',
      url: '/api/forecasts',
      payload: { ...payload, amountMicros: 2_000_000 },
    });
    expect(again.statusCode, again.body).toBe(201);
    expect(again.json()).toMatchObject({ amountMicros: 2_000_000, note: null });

    const list = await server.inject({ method: 'GET', url: '/api/forecasts?period=2031-Q2' });
    expect(list.statusCode).toBe(200);
  });
});

// Integration test for the on-demand provider-health "Test now" endpoint.
import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../../server.js';
import { makeSkipIfNoDb } from '../../test-support/skip-if-no-db.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (server) await server.close();
  if (dbReachable) await prisma.$disconnect();
});

const t = makeSkipIfNoDb(() => dbReachable);

describe('POST /crm/provider-health/test', () => {
  t('re-checks providers on demand and returns a fresh timestamp', async () => {
    const res = await server.inject({ method: 'POST', url: '/api/crm/provider-health/test' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      items: { provider: string; status: string }[];
      checkedAt: string;
    };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items[0]).toHaveProperty('status');
    // Fresh timestamp from this call.
    expect(Date.now() - new Date(body.checkedAt).getTime()).toBeLessThan(60_000);
  });
});

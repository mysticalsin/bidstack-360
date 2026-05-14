import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../../server.js';

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

const skipIfNoDb = (name: string, fn: () => Promise<void> | void) =>
  it(name, async () => {
    if (!dbReachable) {
      console.warn(`[skip] ${name} — DATABASE_URL not reachable`);
      return;
    }
    await fn();
  });

describe('crm health routes', () => {
  skipIfNoDb('GET /api/crm/data-quality returns an auditable issue report', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/crm/data-quality' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.generatedAt).toEqual(expect.any(String));
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.counts).toEqual(expect.any(Object));
  });

  skipIfNoDb('GET /api/crm/provider-health returns provider health items', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/crm/provider-health' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
    if (body.items.length > 0) {
      expect(body.items[0]).toEqual(
        expect.objectContaining({
          provider: expect.any(String),
          status: expect.any(String),
        }),
      );
    }
  });
});

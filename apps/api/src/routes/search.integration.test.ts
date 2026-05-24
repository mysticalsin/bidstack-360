// Integration tests for /api/search.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';

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

describe('search routes', () => {
  skipIfNoDb('GET /api/search finds opportunities by customer', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/search?q=MAHLE' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.some((r: { type: string }) => r.type === 'opportunity')).toBe(true);
  });

  skipIfNoDb('GET /api/search filters by types', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/search?q=MAHLE&types=opportunity' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.every((r: { type: string }) => r.type === 'opportunity')).toBe(true);
  });

  skipIfNoDb('GET /api/search limits results per type', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/search?q=a&limit=2' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.length).toBeLessThanOrEqual(30); // totalCap
  });

  skipIfNoDb('GET /api/search returns empty for nonsense query', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/search?q=xyznonsense12345' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.length).toBe(0);
  });

  skipIfNoDb('GET /api/search rejects empty query', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/search?q=' });
    expect(res.statusCode).toBe(400);
  });
});

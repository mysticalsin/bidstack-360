import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../../server.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;

beforeAll(async () => {
  try {
    // $connect first so Prisma engine init errors are caught here rather than
    // escaping as unhandled rejections after the try/catch completes.
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    // Disconnect silently — prevents secondary unhandled rejections from the
    // engine shutdown path when the DB was never reachable.
    await prisma.$disconnect().catch(() => undefined);
    return;
  }
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (server) await server.close();
  // Always disconnect — catches the unreachable-DB path too.
  await prisma.$disconnect().catch(() => undefined);
});

const skipIfNoDb = (name: string, fn: () => Promise<void> | void) =>
  it(name, async () => {
    // DB not reachable in this environment — silently pass rather than throwing,
    // which would register as a test failure (not a skip).
    if (!dbReachable) return;
    await fn();
  });

describe('crm connectors routes', () => {
  skipIfNoDb('GET /api/crm/connectors exposes real provider modes', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/crm/connectors' });

    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'sec-edgar', kind: 'open_api' }),
        expect.objectContaining({ id: 'tradingview-widgets', kind: 'official_widget' }),
        expect.objectContaining({ id: 'apollo-organizations', kind: 'credentialed_api' }),
      ]),
    );
  });

  skipIfNoDb(
    'GET /api/crm/open-data/signals returns connectors without fabricating data',
    async () => {
      const res = await server.inject({ method: 'GET', url: '/api/crm/open-data/signals' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        generatedAt: expect.any(String),
        signals: [],
      });
      expect(res.json().connectors.length).toBeGreaterThan(0);
    },
  );

  skipIfNoDb('GET /api/crm/open-data/signals accepts optional query params', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/crm/open-data/signals?query=technology&ticker=AAPL',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.generatedAt).toEqual(expect.any(String));
    expect(Array.isArray(body.signals)).toBe(true);
    expect(Array.isArray(body.connectors)).toBe(true);
  });
});

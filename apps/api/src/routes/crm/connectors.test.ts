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

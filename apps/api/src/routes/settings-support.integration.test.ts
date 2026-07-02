import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

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

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable);

describe('settings support routes', () => {
  skipIfNoDb('loads bounded admin support data used by Settings', async () => {
    const leadRot = await server.inject({ method: 'GET', url: '/api/lead-rot/config' });
    expect(leadRot.statusCode).toBe(200);
    expect(leadRot.json()).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          id: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
          ),
          status: 'new',
          rottenDays: expect.any(Number),
        }),
      ]),
    });

    const emailTemplates = await server.inject({
      method: 'GET',
      url: '/api/email-templates',
    });
    expect(emailTemplates.statusCode).toBe(200);
    expect(emailTemplates.json()).toMatchObject({ items: expect.any(Array) });

    const tags = await server.inject({ method: 'GET', url: '/api/tags' });
    expect(tags.statusCode).toBe(200);
    expect(tags.json()).toMatchObject({ items: expect.any(Array) });
  });
});

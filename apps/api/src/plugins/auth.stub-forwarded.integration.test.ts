// Stub auth is localhost-only so a dev process on a shared network is not a
// passwordless admin session. The Vite dev server proxies /api and, with
// xfwd, tells the API who the browser was. A loopback socket plus a
// non-loopback X-Forwarded-For is that browser. Trusting the socket alone
// would treat every proxied client as local.
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
}, 120_000);

afterAll(async () => {
  if (server) await server.close();
}, 30_000);

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable);

describe('stub auth refuses a proxied non-local client', () => {
  skipIfNoDb('a loopback socket with a public X-Forwarded-For is not stub-authenticated', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/me',
      remoteAddress: '127.0.0.1',
      headers: { 'x-forwarded-for': '203.0.113.8' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain('203.0.113.8');
  });

  skipIfNoDb('a loopback client with no forwarded address still gets the stub session', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/me',
      remoteAddress: '127.0.0.1',
    });
    expect(res.statusCode).toBe(200);
  });

  skipIfNoDb('a loopback forwarded address is still local', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/me',
      remoteAddress: '127.0.0.1',
      headers: { 'x-forwarded-for': '127.0.0.1' },
    });
    expect(res.statusCode).toBe(200);
  });
});

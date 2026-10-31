import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { registerFrontDoorGuard } from './front-door-guard.js';

const FDID = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';

async function app(expected: string | undefined) {
  const s = Fastify();
  registerFrontDoorGuard(s, expected);
  s.get('/api/v1/ping', async () => ({ ok: true }));
  s.get('/readyz', async () => ({ ok: true }));
  await s.ready();
  return s;
}

describe('Front Door origin lock', () => {
  it('rejects requests that bypassed Front Door', async () => {
    const s = await app(FDID);
    expect((await s.inject({ url: '/api/v1/ping' })).statusCode).toBe(403);
    expect(
      (await s.inject({ url: '/api/v1/ping', headers: { 'x-azure-fdid': 'some-other-profile' } }))
        .statusCode,
    ).toBe(403);
    await s.close();
  });

  it('accepts the configured Front Door id (case-insensitive)', async () => {
    const s = await app(FDID);
    const res = await s.inject({ url: '/api/v1/ping', headers: { 'x-azure-fdid': FDID.toUpperCase() } });
    expect(res.statusCode).toBe(200);
    await s.close();
  });

  it('exempts platform probes', async () => {
    const s = await app(FDID);
    expect((await s.inject({ url: '/readyz' })).statusCode).toBe(200);
    await s.close();
  });

  it('is a no-op when unset', async () => {
    const s = await app('');
    expect((await s.inject({ url: '/api/v1/ping' })).statusCode).toBe(200);
    await s.close();
  });
});

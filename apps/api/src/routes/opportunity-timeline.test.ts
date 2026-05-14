import { describe, expect, it, beforeAll, afterAll } from 'vitest';

import { buildServer } from '../server.js';

let server: Awaited<ReturnType<typeof buildServer>>;

describe('opportunity timeline', () => {
  beforeAll(async () => {
    server = await buildServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it('returns 404 for an opportunity that does not exist', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/opportunities/00000000-0000-0000-0000-000000000000/timeline',
      headers: { authorization: 'Bearer stub' },
    });
    expect(res.statusCode).toBe(404);
  });

  it.skip('returns timeline items for an existing opportunity', async () => {
    // Find a seed opportunity
    const listRes = await server.inject({
      method: 'GET',
      url: '/api/opportunities',
      headers: { authorization: 'Bearer stub' },
    });
    const list = JSON.parse(listRes.body);
    expect(list.items.length).toBeGreaterThan(0);
    const opp = list.items[0];

    const res = await server.inject({
      method: 'GET',
      url: `/api/opportunities/${opp.id}/timeline`,
      headers: { authorization: 'Bearer stub' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.items)).toBe(true);
  });
});

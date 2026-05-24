import { describe, it, expect } from 'vitest';

import { buildServer } from '../server.js';

describe('request-id correlation', () => {
  it('generates a UUID request id when no header is present', async () => {
    const server = await buildServer();
    server.get('/test-req-id', async (req) => ({ id: req.id }));

    const res = await server.inject({ url: '/test-req-id' });
    expect(res.statusCode).toBe(200);
    const header = res.headers['x-request-id'];
    expect(header).toBeDefined();
    expect(header).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(res.json()).toEqual({ id: header });
    await server.close();
  });

  it('echoes a valid incoming X-Request-Id header', async () => {
    const server = await buildServer();
    server.get('/test-req-id', async (req) => ({ id: req.id }));

    const incoming = 'abc12345-abc1-abc1-abc1-abc123456789';
    const res = await server.inject({
      url: '/test-req-id',
      headers: { 'X-Request-Id': incoming },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-request-id']).toBe(incoming);
    expect(res.json()).toEqual({ id: incoming });
    await server.close();
  });

  it('ignores too-short incoming request ids and generates a new one', async () => {
    const server = await buildServer();
    server.get('/test-req-id', async (req) => ({ id: req.id }));

    const res = await server.inject({
      url: '/test-req-id',
      headers: { 'X-Request-Id': 'short' },
    });
    expect(res.statusCode).toBe(200);
    const header = res.headers['x-request-id'];
    expect(header).not.toBe('short');
    expect(header).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    await server.close();
  });

  it('ignores too-long incoming request ids and generates a new one', async () => {
    const server = await buildServer();
    server.get('/test-req-id', async (req) => ({ id: req.id }));

    const longId = 'a'.repeat(256);
    const res = await server.inject({
      url: '/test-req-id',
      headers: { 'X-Request-Id': longId },
    });
    expect(res.statusCode).toBe(200);
    const header = res.headers['x-request-id'];
    expect(header).not.toBe(longId);
    expect(header).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    await server.close();
  });
});

import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';

import { apiVersioningPlugin } from './api-versioning.js';

describe('apiVersioningPlugin', () => {
  it('adds X-API-Version header to all responses', async () => {
    const server = Fastify({ logger: false });
    await server.register(sensible);
    await server.register(apiVersioningPlugin);
    server.get('/health', async () => ({ ok: true }));

    const res = await server.inject({ url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-api-version']).toBe('v1');
  });

  it('detects version from path prefix', async () => {
    const server = Fastify({ logger: false });
    await server.register(sensible);
    await server.register(apiVersioningPlugin);
    server.get('/api/v1/test', async (req) => ({ version: req.apiVersion }));

    const res = await server.inject({ url: '/api/v1/test' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-api-version']).toBe('v1');
    expect(res.json()).toEqual({ version: 'v1' });
  });

  it('defaults to v1 when no version is specified', async () => {
    const server = Fastify({
      logger: false,
      rewriteUrl: (req) => {
        const url = req.url ?? '';
        if (url.startsWith('/api/') && !url.startsWith('/api/v')) {
          return url.replace(/^\/api\//, '/api/v1/');
        }
        return url;
      },
    });
    await server.register(sensible);
    await server.register(apiVersioningPlugin);
    server.get('/api/v1/test', async (req) => ({ version: req.apiVersion }));

    const res = await server.inject({ url: '/api/test' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-api-version']).toBe('v1');
    expect(res.json()).toEqual({ version: 'v1' });
  });

  it('rejects mismatched header and path versions', async () => {
    const server = Fastify({ logger: false });
    await server.register(sensible);
    await server.register(apiVersioningPlugin);
    server.get('/api/v1/test', async () => ({ ok: true }));

    const res = await server.inject({
      url: '/api/v1/test',
      headers: { 'X-API-Version': '2' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects unsupported API versions', async () => {
    const server = Fastify({ logger: false });
    await server.register(sensible);
    await server.register(apiVersioningPlugin);
    server.get('/api/v1/test', async () => ({ ok: true }));

    const res = await server.inject({ url: '/api/v2/test' });
    expect(res.statusCode).toBe(400);
  });
});

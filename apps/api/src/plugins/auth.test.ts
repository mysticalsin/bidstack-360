import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { authPlugin } from './auth.js';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_CLERK_KEY = process.env.CLERK_SECRET_KEY;

describe('auth plugin', () => {
  beforeEach(() => {
    delete process.env.NODE_ENV;
    delete process.env.CLERK_SECRET_KEY;
  });

  afterEach(() => {
    if (ORIGINAL_NODE_ENV === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    }
    if (ORIGINAL_CLERK_KEY === undefined) {
      delete process.env.CLERK_SECRET_KEY;
    } else {
      process.env.CLERK_SECRET_KEY = ORIGINAL_CLERK_KEY;
    }
  });

  it('refuses to start when NODE_ENV is unset and CLERK_SECRET_KEY is missing', async () => {
    const server = Fastify({ logger: false });
    await expect(server.register(authPlugin)).rejects.toThrow(
      'CLERK_SECRET_KEY required in production',
    );
  });

  it('allows stub auth when NODE_ENV=development and CLERK_SECRET_KEY is missing', async () => {
    process.env.NODE_ENV = 'development';
    const server = Fastify({ logger: false });
    await expect(server.register(authPlugin)).resolves.not.toThrow();
  });

  it('does not resolve auth for routes explicitly marked public', async () => {
    process.env.NODE_ENV = 'development';
    const server = Fastify({ logger: false });

    await server.register(authPlugin);
    server.get('/public-probe', { config: { public: true } }, async () => ({ ok: true }));

    try {
      const response = await server.inject({ method: 'GET', url: '/public-probe' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
    } finally {
      await server.close();
    }
  });

  it('refuses to start when NODE_ENV=production and CLERK_SECRET_KEY is missing', async () => {
    process.env.NODE_ENV = 'production';
    const server = Fastify({ logger: false });
    await expect(server.register(authPlugin)).rejects.toThrow(
      'CLERK_SECRET_KEY required in production',
    );
  });
});

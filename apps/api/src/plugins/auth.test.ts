import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { verifyToken } from '@clerk/backend';

import {
  SSO_DOMAIN_REJECTED_MESSAGE,
  authPlugin,
  parseAllowedSsoDomains,
  ssoDomainRejectionLogFields,
} from './auth.js';

vi.mock('@clerk/backend', () => ({
  verifyToken: vi.fn(),
}));

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_CLERK_KEY = process.env.CLERK_SECRET_KEY;
const ORIGINAL_PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;
const ORIGINAL_SSO_ALLOWED_EMAIL_DOMAINS = process.env.SSO_ALLOWED_EMAIL_DOMAINS;

describe('auth plugin', () => {
  beforeEach(() => {
    delete process.env.NODE_ENV;
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.PUBLIC_BASE_URL;
    delete process.env.SSO_ALLOWED_EMAIL_DOMAINS;
    vi.clearAllMocks();
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
    if (ORIGINAL_PUBLIC_BASE_URL === undefined) {
      delete process.env.PUBLIC_BASE_URL;
    } else {
      process.env.PUBLIC_BASE_URL = ORIGINAL_PUBLIC_BASE_URL;
    }
    if (ORIGINAL_SSO_ALLOWED_EMAIL_DOMAINS === undefined) {
      delete process.env.SSO_ALLOWED_EMAIL_DOMAINS;
    } else {
      process.env.SSO_ALLOWED_EMAIL_DOMAINS = ORIGINAL_SSO_ALLOWED_EMAIL_DOMAINS;
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

  it('normalizes configured SSO domains before policy comparison', () => {
    expect(parseAllowedSsoDomains(' MANTU.COM, bidstack.local ,, ')).toEqual([
      'mantu.com',
      'bidstack.local',
    ]);
  });

  it('logs SSO domain rejections without exposing the rejected email or allowlist', () => {
    const fields = ssoDomainRejectionLogFields('alice.secret@example.com', [
      'mantu.com',
      'bidstack.local',
    ]);

    expect(fields).toEqual({
      userDomain: 'example.com',
      allowedDomainCount: 2,
    });
    expect(JSON.stringify(fields)).not.toContain('alice.secret');
    expect(JSON.stringify(fields)).not.toContain('mantu.com');
    expect(JSON.stringify(fields)).not.toContain('bidstack.local');
  });

  it('uses a generic SSO rejection response that does not reveal tenant allowlists', () => {
    expect(SSO_DOMAIN_REJECTED_MESSAGE).toBe(
      'Sign-in domain is not permitted for this organization.',
    );
    expect(SSO_DOMAIN_REJECTED_MESSAGE).not.toContain('@');
    expect(SSO_DOMAIN_REJECTED_MESSAGE).not.toContain('Allowed domains');
  });

  it('returns a generic 403 for verified-token SSO domain policy failures', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CLERK_SECRET_KEY = 'sk_test_auth_policy';
    process.env.PUBLIC_BASE_URL = 'https://app.bidstack.test';
    process.env.SSO_ALLOWED_EMAIL_DOMAINS = 'mantu.com';
    vi.mocked(verifyToken).mockResolvedValue({
      org_id: 'org_clerk',
      sub: 'user_clerk',
      email: 'alice.secret@example.com',
    } as never);

    const server = Fastify({ logger: false });
    await server.register(sensible);
    await server.register(authPlugin);
    server.get('/private-probe', async () => ({ ok: true }));

    try {
      const response = await server.inject({
        method: 'GET',
        url: '/private-probe',
        headers: { authorization: 'Bearer verified-but-rejected' },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({
        statusCode: 403,
        error: 'Forbidden',
        message: SSO_DOMAIN_REJECTED_MESSAGE,
      });
      expect(response.body).not.toContain('alice.secret');
      expect(response.body).not.toContain('mantu.com');
      expect(response.body).not.toContain('Invalid or expired token');
    } finally {
      await server.close();
    }
  });
});

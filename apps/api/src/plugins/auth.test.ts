import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { verifyToken } from '@clerk/backend';

import { prisma } from '@bidstack/db';

import {
  SSO_DOMAIN_REJECTED_MESSAGE,
  __clearAuthCacheForTests,
  authPlugin,
  parseAllowedSsoDomains,
  ssoDomainRejectionLogFields,
} from './auth.js';
import { writeAuthAudit } from './auth-audit.js';

vi.mock('@clerk/backend', () => ({
  verifyToken: vi.fn(),
}));

// Mock the DB so the Clerk slow-path resolution runs without Postgres. Only the
// methods verifyClerkAuth touches are stubbed; the SSO-rejection test throws
// before any of these are reached, so the mock is inert there.
vi.mock('@bidstack/db', () => ({
  prisma: {
    org: { findUnique: vi.fn() },
    user: { findUnique: vi.fn(), upsert: vi.fn() },
    role: { findFirst: vi.fn() },
    userRole: { upsert: vi.fn() },
    apiKey: { findFirst: vi.fn(), update: vi.fn() },
  },
}));

// Stub the audit-log helper so we can assert call counts without a DB write.
vi.mock('./auth-audit.js', () => ({
  writeAuthAudit: vi.fn(),
}));

const mockedOrgFindUnique = vi.mocked(prisma.org.findUnique);
const mockedUserFindUnique = vi.mocked(prisma.user.findUnique);
const mockedUserUpsert = vi.mocked(prisma.user.upsert);
const mockedApiKeyFindFirst = vi.mocked(prisma.apiKey.findFirst);
const mockedWriteAuthAudit = vi.mocked(writeAuthAudit);

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

  describe('verified-session cache (scale fix)', () => {
    // WHY this matters: the onRequest hook runs verifyClerkAuth on EVERY
    // authenticated request. Before the cache, each one did 3 reads + a
    // user.upsert + an auth.login audit write to the Postgres PRIMARY. At
    // 100k-scale that melts the primary. These tests lock in that a repeated
    // request with the same token does NOT re-hit the write path, AND that the
    // security rejections still fire on the (uncached) miss path.

    async function buildClerkServer() {
      const server = Fastify({ logger: false });
      await server.register(sensible);
      await server.register(authPlugin);
      server.get('/private-probe', async (req) => ({ orgId: req.auth.orgId }));
      await server.ready();
      return server;
    }

    function inject(server: Awaited<ReturnType<typeof buildClerkServer>>, token: string) {
      return server.inject({
        method: 'GET',
        url: '/private-probe',
        headers: { authorization: `Bearer ${token}` },
      });
    }

    beforeEach(() => {
      __clearAuthCacheForTests();
      process.env.NODE_ENV = 'production';
      process.env.CLERK_SECRET_KEY = 'sk_test_cache';
      process.env.PUBLIC_BASE_URL = 'https://app.bidstack.test';
      // No x-api-key on these requests, so verifyApiKey returns null and the
      // Clerk path runs. Guard against an accidental key match anyway.
      mockedApiKeyFindFirst.mockResolvedValue(null as never);
    });

    it('serves a second same-token request from cache without re-hitting upsert / auditLog', async () => {
      vi.mocked(verifyToken).mockResolvedValue({
        org_id: 'org_clerk',
        sub: 'user_clerk',
        sid: 'sess_1',
        org_role: 'org:member',
        email: 'bob@mantu.com',
      } as never);
      mockedOrgFindUnique.mockResolvedValue({ id: 'org-uuid-1' } as never);
      mockedUserFindUnique.mockResolvedValue(null as never); // first sign-in
      mockedUserUpsert.mockResolvedValue({
        id: 'user-uuid-1',
        role: 'member',
        email: 'bob@mantu.com',
      } as never);

      const server = await buildClerkServer();
      try {
        const first = await inject(server, 'tok-A');
        expect(first.statusCode).toBe(200);
        expect(first.json()).toEqual({ orgId: 'org-uuid-1' });

        // Miss path ran exactly once: one upsert, one auth.login audit.
        expect(mockedUserUpsert).toHaveBeenCalledTimes(1);
        expect(
          mockedWriteAuthAudit.mock.calls.filter((c) => c[1]?.action === 'auth.login'),
        ).toHaveLength(1);

        const second = await inject(server, 'tok-A');
        expect(second.statusCode).toBe(200);
        expect(second.json()).toEqual({ orgId: 'org-uuid-1' });

        // The second request hit the cache: NO new DB write, NO new audit row.
        expect(mockedUserUpsert).toHaveBeenCalledTimes(1);
        expect(mockedOrgFindUnique).toHaveBeenCalledTimes(1);
        expect(
          mockedWriteAuthAudit.mock.calls.filter((c) => c[1]?.action === 'auth.login'),
        ).toHaveLength(1);

        // The signature is still verified on every request (CPU, not DB).
        expect(vi.mocked(verifyToken)).toHaveBeenCalledTimes(2);
      } finally {
        await server.close();
      }
    });

    it('keeps the org-not-registered 404 on the miss path', async () => {
      vi.mocked(verifyToken).mockResolvedValue({
        org_id: 'org_unknown',
        sub: 'user_x',
        sid: 'sess_x',
        org_role: 'org:member',
        email: 'x@mantu.com',
      } as never);
      mockedOrgFindUnique.mockResolvedValue(null as never);

      const server = await buildClerkServer();
      try {
        const res = await inject(server, 'tok-unknown-org');
        expect(res.statusCode).toBe(404);
        // Rejection must never be cached as a successful AuthContext.
        expect(mockedUserUpsert).not.toHaveBeenCalled();
      } finally {
        await server.close();
      }
    });

    it('keeps the cross-org rejection on the miss path and never caches it', async () => {
      vi.mocked(verifyToken).mockResolvedValue({
        org_id: 'org_clerk',
        sub: 'user_crossorg',
        sid: 'sess_c',
        org_role: 'org:member',
        email: 'c@mantu.com',
      } as never);
      mockedOrgFindUnique.mockResolvedValue({ id: 'org-uuid-1' } as never);
      // Existing clerkUser belongs to a DIFFERENT org → cross-org attempt.
      mockedUserFindUnique.mockResolvedValue({
        id: 'user-other',
        orgId: 'org-uuid-OTHER',
        role: 'member',
      } as never);

      const server = await buildClerkServer();
      try {
        const first = await inject(server, 'tok-crossorg');
        expect(first.statusCode).toBe(403);
        expect(first.json().message).toBe('User is already registered in another organization');
        expect(mockedUserUpsert).not.toHaveBeenCalled();

        // A second attempt must re-run the check (no poisoned cache entry).
        const second = await inject(server, 'tok-crossorg');
        expect(second.statusCode).toBe(403);
        expect(mockedOrgFindUnique).toHaveBeenCalledTimes(2);
        expect(mockedUserUpsert).not.toHaveBeenCalled();
      } finally {
        await server.close();
      }
    });

    it('keeps the unknown-role rejection on the miss path', async () => {
      vi.mocked(verifyToken).mockResolvedValue({
        org_id: 'org_clerk',
        sub: 'user_badrole',
        sid: 'sess_r',
        org_role: 'org:wizard',
        email: 'r@mantu.com',
      } as never);
      mockedOrgFindUnique.mockResolvedValue({ id: 'org-uuid-1' } as never);

      const server = await buildClerkServer();
      try {
        const res = await inject(server, 'tok-badrole');
        expect(res.statusCode).toBe(403);
        expect(res.json().message).toContain('Unrecognized organization role');
        expect(mockedUserUpsert).not.toHaveBeenCalled();
        // login_failed audit is still emitted for the unknown role.
        expect(
          mockedWriteAuthAudit.mock.calls.filter((c) => c[1]?.action === 'auth.login_failed'),
        ).toHaveLength(1);
      } finally {
        await server.close();
      }
    });

    it('does not collide cache entries across distinct users', async () => {
      mockedOrgFindUnique.mockResolvedValue({ id: 'org-uuid-1' } as never);
      mockedUserFindUnique.mockResolvedValue(null as never);

      vi.mocked(verifyToken)
        .mockResolvedValueOnce({
          org_id: 'org_clerk',
          sub: 'user_alpha',
          sid: 'sess_a',
          org_role: 'org:member',
          email: 'alpha@mantu.com',
        } as never)
        .mockResolvedValueOnce({
          org_id: 'org_clerk',
          sub: 'user_beta',
          sid: 'sess_b',
          org_role: 'org:member',
          email: 'beta@mantu.com',
        } as never);
      mockedUserUpsert
        .mockResolvedValueOnce({ id: 'u-alpha', role: 'member', email: 'alpha@mantu.com' } as never)
        .mockResolvedValueOnce({ id: 'u-beta', role: 'member', email: 'beta@mantu.com' } as never);

      const server = await buildClerkServer();
      try {
        const a = await inject(server, 'tok-alpha');
        const b = await inject(server, 'tok-beta');
        expect(a.statusCode).toBe(200);
        expect(b.statusCode).toBe(200);
        // Two distinct identities → two miss-path resolutions, no collision.
        expect(mockedUserUpsert).toHaveBeenCalledTimes(2);
      } finally {
        await server.close();
      }
    });
  });
});

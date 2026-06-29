import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@bidstack/db', () => ({
  prisma: {
    userRole: {
      count: vi.fn(),
    },
  },
}));

import { prisma } from '@bidstack/db';
import { rbacPlugin } from './rbac.js';

const userRoleCount = vi.mocked(prisma.userRole.count);
const originalNodeEnv = process.env.NODE_ENV;
const originalLegacyScopeFlag = process.env.BIDSTACK_ALLOW_LEGACY_API_KEY_SCOPES;

async function buildRbacTestServer(auth: {
  orgId: string;
  userId: string;
  role: string;
  scopes?: string[];
}) {
  const server = Fastify({ logger: false });
  await server.register(sensible);
  await server.register(rbacPlugin);

  server.addHook('onRequest', async (req) => {
    req.auth = {
      orgId: auth.orgId,
      userId: auth.userId,
      role: auth.role,
      scopes: auth.scopes ?? ['read', 'write'],
    };
  });

  server.get('/role', { preHandler: server.requireRole('manager') }, async () => ({ ok: true }));
  server.get(
    '/human',
    { preHandler: server.requireHumanActor('Human route requires a user session') },
    async () => ({ ok: true }),
  );
  server.get(
    '/permission',
    { preHandler: server.requirePermission('settings:write') },
    async () => ({ ok: true }),
  );
  server.get(
    '/read-permission',
    { preHandler: server.requirePermission('settings:read') },
    async () => ({ ok: true }),
  );

  await server.ready();
  return server;
}

describe('rbac plugin', () => {
  beforeEach(() => {
    userRoleCount.mockReset();
    process.env.NODE_ENV = originalNodeEnv;
    if (originalLegacyScopeFlag === undefined) {
      delete process.env.BIDSTACK_ALLOW_LEGACY_API_KEY_SCOPES;
    } else {
      process.env.BIDSTACK_ALLOW_LEGACY_API_KEY_SCOPES = originalLegacyScopeFlag;
    }
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalLegacyScopeFlag === undefined) {
      delete process.env.BIDSTACK_ALLOW_LEGACY_API_KEY_SCOPES;
    } else {
      process.env.BIDSTACK_ALLOW_LEGACY_API_KEY_SCOPES = originalLegacyScopeFlag;
    }
  });

  it('rejects a legacy role claim without a database role grant', async () => {
    userRoleCount.mockResolvedValueOnce(0);
    const server = await buildRbacTestServer({
      orgId: 'org-1',
      userId: 'user-1',
      role: 'manager',
    });

    const res = await server.inject({ method: 'GET', url: '/role' });

    expect(res.statusCode).toBe(403);
    expect(userRoleCount).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        user: { orgId: 'org-1', deletedAt: null },
        role: {
          orgId: 'org-1',
          OR: [{ name: { equals: 'manager', mode: 'insensitive' } }],
          deletedAt: null,
        },
      },
    });
    await server.close();
  });

  it('allows a database-assigned role in the current org', async () => {
    userRoleCount.mockResolvedValueOnce(1);
    const server = await buildRbacTestServer({
      orgId: 'org-1',
      userId: 'user-1',
      role: 'viewer',
    });

    const res = await server.inject({ method: 'GET', url: '/role' });

    expect(res.statusCode).toBe(200);
    expect(userRoleCount).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        user: { orgId: 'org-1', deletedAt: null },
        role: {
          orgId: 'org-1',
          OR: [{ name: { equals: 'manager', mode: 'insensitive' } }],
          deletedAt: null,
        },
      },
    });
    await server.close();
  });

  it('rejects a user without the required role', async () => {
    userRoleCount.mockResolvedValueOnce(0);
    const server = await buildRbacTestServer({
      orgId: 'org-1',
      userId: 'user-1',
      role: 'viewer',
    });

    const res = await server.inject({ method: 'GET', url: '/role' });

    expect(res.statusCode).toBe(403);
    await server.close();
  });

  it('rejects API keys at role gates without querying user-role rows', async () => {
    const server = await buildRbacTestServer({
      orgId: 'org-1',
      userId: 'apikey:key-1',
      role: 'api',
      scopes: ['read', 'write'],
    });

    const res = await server.inject({ method: 'GET', url: '/role' });

    expect(res.statusCode).toBe(403);
    expect(userRoleCount).not.toHaveBeenCalled();
    await server.close();
  });

  it('allows a human session through human-only gates without querying user-role rows', async () => {
    const server = await buildRbacTestServer({
      orgId: 'org-1',
      userId: 'user-1',
      role: 'viewer',
    });

    const res = await server.inject({ method: 'GET', url: '/human' });

    expect(res.statusCode).toBe(200);
    expect(userRoleCount).not.toHaveBeenCalled();
    await server.close();
  });

  it('rejects API keys at human-only gates without querying user-role rows', async () => {
    const server = await buildRbacTestServer({
      orgId: 'org-1',
      userId: 'apikey:key-1',
      role: 'api',
      scopes: ['settings:write'],
    });

    const res = await server.inject({ method: 'GET', url: '/human' });

    expect(res.statusCode).toBe(403);
    expect(res.json<{ message: string }>().message).toContain('user session');
    expect(userRoleCount).not.toHaveBeenCalled();
    await server.close();
  });

  it('allows a database-granted permission in the current org', async () => {
    userRoleCount.mockResolvedValueOnce(1);
    const server = await buildRbacTestServer({
      orgId: 'org-1',
      userId: 'user-1',
      role: 'viewer',
    });

    const res = await server.inject({ method: 'GET', url: '/permission' });

    expect(res.statusCode).toBe(200);
    expect(userRoleCount).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        user: { orgId: 'org-1', deletedAt: null },
        role: {
          orgId: 'org-1',
          deletedAt: null,
          permissions: {
            some: {
              permission: { key: 'settings:write' },
            },
          },
        },
      },
    });
    await server.close();
  });

  it('rejects an admin claim without an explicit Admin UserRole grant', async () => {
    // Regression guard for the removed `req.auth.role === 'admin'` fallback.
    // Even when the Clerk token says the caller is an admin, requirePermission
    // must consult the UserRole + RolePermission tables. Mirror Salesforce's
    // model: claims announce identity, the database authorises.
    userRoleCount.mockResolvedValueOnce(0);
    const server = await buildRbacTestServer({
      orgId: 'org-1',
      userId: 'admin-1',
      role: 'admin',
    });

    const res = await server.inject({ method: 'GET', url: '/permission' });

    expect(res.statusCode).toBe(403);
    expect(userRoleCount).toHaveBeenCalledTimes(1);
    await server.close();
  });

  it('allows an admin claim that ALSO has an Admin UserRole grant', async () => {
    // Counterpart to the regression test above — the JIT provisioner in
    // apps/api/src/plugins/auth.ts (`ensureAdminRoleGrant`) is responsible for
    // making this case true on first sign-in.
    userRoleCount.mockResolvedValueOnce(1);
    const server = await buildRbacTestServer({
      orgId: 'org-1',
      userId: 'admin-1',
      role: 'admin',
    });

    const res = await server.inject({ method: 'GET', url: '/permission' });

    expect(res.statusCode).toBe(200);
    await server.close();
  });

  it('rejects a user without the required permission', async () => {
    userRoleCount.mockResolvedValueOnce(0);
    const server = await buildRbacTestServer({
      orgId: 'org-1',
      userId: 'user-1',
      role: 'viewer',
    });

    const res = await server.inject({ method: 'GET', url: '/permission' });

    expect(res.statusCode).toBe(403);
    await server.close();
  });

  it('allows API keys through read gates when they have read scope', async () => {
    const server = await buildRbacTestServer({
      orgId: 'org-1',
      userId: 'apikey:key-1',
      role: 'api',
      scopes: ['read'],
    });

    const res = await server.inject({ method: 'GET', url: '/read-permission' });

    expect(res.statusCode).toBe(200);
    expect(userRoleCount).not.toHaveBeenCalled();
    await server.close();
  });

  it('allows API keys through exact permission scopes', async () => {
    process.env.NODE_ENV = 'production';
    const server = await buildRbacTestServer({
      orgId: 'org-1',
      userId: 'apikey:key-1',
      role: 'api',
      scopes: ['settings:write'],
    });

    const res = await server.inject({ method: 'GET', url: '/permission' });

    expect(res.statusCode).toBe(200);
    expect(userRoleCount).not.toHaveBeenCalled();
    await server.close();
  });

  it('rejects broad API key write scopes in production REST permission gates', async () => {
    process.env.NODE_ENV = 'production';
    const server = await buildRbacTestServer({
      orgId: 'org-1',
      userId: 'apikey:key-1',
      role: 'api',
      scopes: ['read', 'write'],
    });

    const res = await server.inject({ method: 'GET', url: '/permission' });

    expect(res.statusCode).toBe(403);
    expect(res.json<{ message: string }>().message).toContain(
      'Requires API key scope: settings:write',
    );
    expect(userRoleCount).not.toHaveBeenCalled();
    await server.close();
  });

  it('allows legacy broad API key scopes in production only when explicitly enabled', async () => {
    process.env.NODE_ENV = 'production';
    process.env.BIDSTACK_ALLOW_LEGACY_API_KEY_SCOPES = 'true';
    const server = await buildRbacTestServer({
      orgId: 'org-1',
      userId: 'apikey:key-1',
      role: 'api',
      scopes: ['write'],
    });

    const res = await server.inject({ method: 'GET', url: '/permission' });

    expect(res.statusCode).toBe(200);
    expect(userRoleCount).not.toHaveBeenCalled();
    await server.close();
  });

  it('rejects read-only API keys at write permission gates', async () => {
    const server = await buildRbacTestServer({
      orgId: 'org-1',
      userId: 'apikey:key-1',
      role: 'api',
      scopes: ['read'],
    });

    const res = await server.inject({ method: 'GET', url: '/permission' });

    expect(res.statusCode).toBe(403);
    expect(userRoleCount).not.toHaveBeenCalled();
    await server.close();
  });
});

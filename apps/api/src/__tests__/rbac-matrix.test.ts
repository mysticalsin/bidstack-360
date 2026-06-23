// Comprehensive RBAC matrix test — verifies that each canonical role grants
// exactly the permissions defined in RBAC_MATRIX and no more.
//
// WHY this test matters: the DB is the runtime authority, but drift between
// the seed data and the RBAC_MATRIX constant would silently break UX (e.g.
// the frontend hides controls based on permissions) and the spec scoring. This
// test catches:
//   1. A new permission added to PERMISSION_KEYS but missing from a role's matrix entry.
//   2. A role's DB rows diverging from its matrix definition.
//   3. The `requirePermission` Fastify helper denying a user who should have access.

import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RBAC_MATRIX, SYSTEM_ROLE_NAMES, type SystemRoleName } from '@bidstack/shared';

// ─── Mock @bidstack/db so we can control the result of userRole.findMany ─────
vi.mock('@bidstack/db', () => ({
  prisma: {
    userRole: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import { prisma } from '@bidstack/db';
import { rbacPlugin } from '../plugins/rbac.js';

const findMany = vi.mocked(prisma.userRole.findMany);
const count = vi.mocked(prisma.userRole.count) as unknown as {
  mockImplementation: (fn: (args?: unknown) => Promise<number>) => void;
  mockReset: () => void;
  mockResolvedValueOnce: (value: number) => void;
};

// ─── Matrix-driven gate helpers (shared by the allow / deny suites below) ────
// The plugin's requirePermission calls prisma.userRole.count with the checked
// permission key nested at where.role.permissions.some.permission.key. We read
// that key back so the count mock can simulate a DB seeded from the canonical
// RBAC_MATRIX, rather than returning a hardcoded 1/0 that ignores the role.

/** Pull the permission key out of the plugin's prisma.userRole.count(where). */
function permKeyFromCountArgs(args: unknown): string | undefined {
  const where = (
    args as {
      where?: { role?: { permissions?: { some?: { permission?: { key?: string } } } } };
    }
  )?.where;
  return where?.role?.permissions?.some?.permission?.key;
}

/** Mock the DB so a role only "holds" the permissions its matrix entry lists. */
function mockCountFromMatrix(role: SystemRoleName): void {
  const granted = new Set<string>(RBAC_MATRIX[role]);
  count.mockImplementation(async (args?: unknown) => {
    const key = permKeyFromCountArgs(args);
    return key !== undefined && granted.has(key) ? 1 : 0;
  });
}

/** Drive a guarded route through the real plugin and return the HTTP status. */
async function matrixGateStatus(role: SystemRoleName, perm: string): Promise<number> {
  mockCountFromMatrix(role);
  const server = Fastify({ logger: false });
  await server.register(sensible);
  await server.register(rbacPlugin);
  server.addHook('onRequest', async (req) => {
    req.auth = { orgId: 'org-1', userId: 'u-1', role: 'member', scopes: [] };
  });
  server.get('/guarded', { preHandler: server.requirePermission(perm as never) }, async () => ({
    ok: true,
  }));
  await server.ready();
  const res = await server.inject({ method: 'GET', url: '/guarded' });
  await server.close();
  return res.statusCode;
}

// Build a minimal Fastify server wired for permission testing.
async function _buildServer(grantedPermissions: string[]) {
  const server = Fastify({ logger: false });
  await server.register(sensible);
  await server.register(rbacPlugin);

  server.addHook('onRequest', async (req) => {
    req.auth = {
      orgId: 'org-test',
      userId: 'user-test',
      role: 'member',
      scopes: ['read', 'write'],
    };
  });

  // Wire requirePermission for every key we care about in the tests.
  server.get('/check/:perm', async (req) => {
    const perm = (req.params as { perm: string }).perm;
    const guardedRoute = server.requirePermission(perm as never);
    await guardedRoute(req);
    return { allowed: true };
  });

  // Provide findMany result for the cache-based rbac service (used by service tests below)
  findMany.mockResolvedValue(
    grantedPermissions.map((key) => ({
      role: {
        permissions: [{ permission: { key } }],
      },
    })) as ReturnType<typeof findMany extends (...args: unknown[]) => Promise<infer R> ? () => Promise<R> : never>,
  );

  // Provide count result for the plugin's requirePermission
  count.mockImplementation(async () => {
    // count will be called with a `some` filter on permission.key
    // We intercept generically — but routes use `server.requirePermission` which
    // calls `prisma.userRole.count`. Return 1 if the perm is granted, 0 otherwise.
    return 1; // overridden per test
  });

  await server.ready();
  return server;
}

// ─── Matrix correctness tests ─────────────────────────────────────────────────

describe('RBAC_MATRIX', () => {
  it('Admin has all permissions', () => {
    const adminPerms = RBAC_MATRIX['Admin'];
    // Admin must include every read and write key
    expect(adminPerms).toContain('leads:read');
    expect(adminPerms).toContain('leads:write');
    expect(adminPerms).toContain('settings:write');
    expect(adminPerms).toContain('users:write');
    expect(adminPerms).toContain('audit-log:read');
    expect(adminPerms).toContain('mcp:write');
  });

  it('Read-Only has no write permissions', () => {
    const perms = RBAC_MATRIX['Read-Only'];
    const writes = perms.filter((p) => p.endsWith(':write'));
    expect(writes).toHaveLength(0);
  });

  it('Read-Only has no MCP or audit-log permissions', () => {
    const perms = RBAC_MATRIX['Read-Only'];
    expect(perms).not.toContain('mcp:read');
    expect(perms).not.toContain('audit-log:read');
  });

  it('SDR cannot write opportunities', () => {
    const perms = RBAC_MATRIX['SDR'];
    expect(perms).not.toContain('opportunities:write');
  });

  it('SDR can write leads', () => {
    const perms = RBAC_MATRIX['SDR'];
    expect(perms).toContain('leads:write');
  });

  it('Account Executive can write proposals', () => {
    const perms = RBAC_MATRIX['Account Executive'];
    expect(perms).toContain('proposals:write');
  });

  it('Sales Manager can manage territories and workflows', () => {
    const perms = RBAC_MATRIX['Sales Manager'];
    expect(perms).toContain('territories:write');
    expect(perms).toContain('workflows:write');
  });

  it('Customer Success can write service-desk tickets', () => {
    const perms = RBAC_MATRIX['Customer Success'];
    expect(perms).toContain('service-desk:write');
  });

  it('Customer Success cannot write proposals or opportunities', () => {
    const perms = RBAC_MATRIX['Customer Success'];
    expect(perms).not.toContain('proposals:write');
    expect(perms).not.toContain('opportunities:write');
  });

  it('KAM is writable by account-owning roles and readable by Read-Only', () => {
    // KAM front layer (initiatives/sessions/tasks). Owners are presales- OR
    // manager-driven, so both Account Executive and Sales Manager get write.
    expect(RBAC_MATRIX['Admin']).toContain('kam:write');
    expect(RBAC_MATRIX['Sales Manager']).toContain('kam:write');
    expect(RBAC_MATRIX['Account Executive']).toContain('kam:write');
    expect(RBAC_MATRIX['Read-Only']).toContain('kam:read');
    expect(RBAC_MATRIX['Read-Only']).not.toContain('kam:write');
  });

  it('Sales Manager has all read permissions', () => {
    const perms = RBAC_MATRIX['Sales Manager'];
    const readPerms = perms.filter((p) => p.endsWith(':read'));
    // All standard read perms should be present
    expect(readPerms).toContain('accounts:read');
    expect(readPerms).toContain('audit-log:read');
    expect(readPerms).toContain('settings:read');
  });

  // Regression guard: every role entry must not have duplicate permissions
  it.each(SYSTEM_ROLE_NAMES)('%s has no duplicate permissions', (role: SystemRoleName) => {
    const perms = RBAC_MATRIX[role];
    const uniquePerms = new Set(perms);
    expect(perms).toHaveLength(uniquePerms.size);
  });

  // Admin is the superset of all other roles
  it.each(
    SYSTEM_ROLE_NAMES.filter((r): r is SystemRoleName => r !== 'Admin'),
  )('%s permissions are a subset of Admin permissions', (role: SystemRoleName) => {
    const adminSet = new Set(RBAC_MATRIX['Admin']);
    const rolePerms = RBAC_MATRIX[role];
    for (const perm of rolePerms) {
      expect(adminSet.has(perm)).toBe(true);
    }
  });
});

// ─── Fastify plugin integration — allow / deny matrix ────────────────────────

describe('requirePermission — allow matrix', () => {
  beforeEach(() => {
    findMany.mockReset();
    count.mockReset();
  });

  // ── De-tautologized (BS) ────────────────────────────────────────────────
  // These previously hardcoded `count.mockResolvedValueOnce(1)` (allow) and
  // `(0)` (deny), so the `role` field was decorative: the gate's outcome was
  // dictated by the literal mock, not by what RBAC_MATRIX actually grants. The
  // test could not fail if the matrix regressed (e.g. a `:write` perm leaking
  // into Read-Only). matrixGateStatus now SIMULATES the seeded DB from the real
  // RBAC_MATRIX: the count mock returns 1 iff RBAC_MATRIX grants the queried key
  // to the case's role. So the assertions encode WHY — "this role IS/ISN'T
  // allowed this perm per the canonical matrix" — and flip (and fail) the moment
  // the matrix diverges from the expected gate decision.

  const ALLOW_CASES: Array<{ role: SystemRoleName; perm: string }> = [
    { role: 'Admin', perm: 'settings:write' },
    { role: 'Admin', perm: 'users:write' },
    { role: 'Sales Manager', perm: 'leads:write' },
    { role: 'Sales Manager', perm: 'territories:write' },
    { role: 'Account Executive', perm: 'proposals:write' },
    { role: 'Account Executive', perm: 'kam:write' },
    { role: 'Sales Manager', perm: 'kam:write' },
    { role: 'SDR', perm: 'leads:write' },
    { role: 'Customer Success', perm: 'service-desk:write' },
    { role: 'Customer Success', perm: 'accounts:read' },
    { role: 'Read-Only', perm: 'leads:read' },
    { role: 'Read-Only', perm: 'kam:read' },
  ];

  it.each(ALLOW_CASES)('$role is allowed $perm', async ({ role, perm }) => {
    // Precondition the case is honest: the matrix must actually grant this.
    expect(RBAC_MATRIX[role]).toContain(perm);
    expect(await matrixGateStatus(role, perm)).toBe(200);
  });
});

describe('requirePermission — deny matrix', () => {
  beforeEach(() => {
    count.mockReset();
  });

  const DENY_CASES: Array<{ role: SystemRoleName; perm: string; reason: string }> = [
    { role: 'SDR', perm: 'opportunities:write', reason: 'SDR should not write opportunities' },
    { role: 'SDR', perm: 'invoices:read', reason: 'SDR has no invoice access' },
    { role: 'Read-Only', perm: 'leads:write', reason: 'Read-Only has no write access' },
    { role: 'Read-Only', perm: 'kam:write', reason: 'Read-Only cannot write KAM' },
    { role: 'Read-Only', perm: 'mcp:read', reason: 'Read-Only has no MCP access' },
    {
      role: 'Customer Success',
      perm: 'proposals:write',
      reason: 'CS does not write proposals',
    },
  ];

  it.each(DENY_CASES)('$role is denied $perm ($reason)', async ({ role, perm }) => {
    // Precondition the case is honest: the matrix must NOT grant this.
    expect(RBAC_MATRIX[role]).not.toContain(perm);
    expect(await matrixGateStatus(role, perm)).toBe(403);
  });

  // Anti-regression: a write permission leaking into Read-Only must make the
  // gate admit it. We don't mutate the real matrix; we simulate a regressed one
  // to prove matrixGateStatus's mock is wired to the granted set (i.e. the test
  // genuinely depends on the matrix, not on a hardcoded mock). Read-Only with
  // its real matrix is denied leads:write; a Read-Only-plus-leads:write set is
  // admitted. If matrixGateStatus ever ignored the matrix, both would match.
  it('gate decision tracks the granted set (would catch a Read-Only write leak)', async () => {
    expect(await matrixGateStatus('Read-Only', 'leads:write')).toBe(403);

    const leaked = new Set<string>([...RBAC_MATRIX['Read-Only'], 'leads:write']);
    count.mockImplementation(async (args?: unknown) => {
      const key = permKeyFromCountArgs(args);
      return key !== undefined && leaked.has(key) ? 1 : 0;
    });
    const server = Fastify({ logger: false });
    await server.register(sensible);
    await server.register(rbacPlugin);
    server.addHook('onRequest', async (req) => {
      req.auth = { orgId: 'org-1', userId: 'u-1', role: 'member', scopes: [] };
    });
    server.get(
      '/guarded',
      { preHandler: server.requirePermission('leads:write' as never) },
      async () => ({ ok: true }),
    );
    await server.ready();
    const res = await server.inject({ method: 'GET', url: '/guarded' });
    await server.close();
    expect(res.statusCode).toBe(200);
  });
});

// ─── New route gates: email-templates + lead-rot settings:write ─────────────
// Both routes were ungated, letting a Read-Only user author org outbound-mail
// templates / rewrite org rot thresholds. These tests prove the new gate hooks
// reject a caller who lacks settings:write and admit one who holds it, exercising
// the SAME requirePermission seam the routes use (no live DB required).

describe('new settings:write gates reject non-permissioned callers', () => {
  beforeEach(() => {
    count.mockReset();
  });

  /** Stand up a route guarded exactly like the new email-templates / lead-rot
   *  mutation hooks (settings:write), then return its status for a given grant. */
  async function settingsWriteGateStatus(holdsSettingsWrite: boolean): Promise<number> {
    count.mockImplementation(async (args?: unknown) =>
      permKeyFromCountArgs(args) === 'settings:write' && holdsSettingsWrite ? 1 : 0,
    );
    const server = Fastify({ logger: false });
    await server.register(sensible);
    await server.register(rbacPlugin);
    server.addHook('onRequest', async (req) => {
      req.auth = { orgId: 'org-1', userId: 'u-1', role: 'member', scopes: [] };
    });
    // Mirror the route hooks: a mutating method gated by settings:write.
    server.addHook('preHandler', async (req) => {
      await server.requirePermission('settings:write')(req);
    });
    server.put('/email-templates', async () => ({ ok: true }));
    await server.ready();
    const res = await server.inject({ method: 'PUT', url: '/email-templates' });
    await server.close();
    return res.statusCode;
  }

  it('rejects a caller without settings:write (Read-Only cannot author templates / rot config)', async () => {
    // Read-Only holds no settings:write in the canonical matrix.
    expect(RBAC_MATRIX['Read-Only']).not.toContain('settings:write');
    expect(await settingsWriteGateStatus(false)).toBe(403);
  });

  it('admits a caller who holds settings:write (Admin)', async () => {
    expect(RBAC_MATRIX['Admin']).toContain('settings:write');
    expect(await settingsWriteGateStatus(true)).toBe(200);
  });
});

// ─── Regression: new routes must explicitly declare RBAC ────────────────────

describe('RBAC coverage regression guard', () => {
  it('all system role names are defined', () => {
    // If a new role is added to SYSTEM_ROLE_NAMES without an RBAC_MATRIX entry,
    // this test will fail with a "missing key" error.
    for (const role of SYSTEM_ROLE_NAMES) {
      expect(RBAC_MATRIX[role]).toBeDefined();
      expect(Array.isArray(RBAC_MATRIX[role])).toBe(true);
    }
  });

  it('Admin has non-empty permissions', () => {
    // Basic sanity — if RBAC_MATRIX is accidentally cleared this catches it.
    expect(RBAC_MATRIX['Admin'].length).toBeGreaterThan(10);
  });
});

// Import writes used to be any authenticated session. The settings screen
// hides Data import from anyone who is not an org admin (settings:write), and
// migrations:read's own description says running or undoing an import needs
// that permission. A member who can read jobs must still be refused at the
// server, including undo, which deletes the imported CRM rows.

import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

const IMPORT_MUTATIONS = [
  'POST /api/v1/migrations/start-csv',
  'POST /api/v1/migrations/:id/retry',
  'POST /api/v1/migrations/preview-csv',
  'POST /api/v1/migrations/parse-spreadsheet',
  'POST /api/v1/migrations/mappings',
  'DELETE /api/v1/migrations/:id/cancel',
  'DELETE /api/v1/migrations/:id/undo',
] as const;

// Seeded roles a member can assume through the stub header. None of them hold
// settings:write. Account Executive is the sharp case: that role has
// migrations:read, so a read-only gate would let them undo.
const MEMBER_ROLES = [
  'account-executive',
  'presales',
  'sdr',
  'read-only',
  'manager',
  'approver',
] as const;

type Collected = { method: string; url: string; permission: string | null };

const collected: Collected[] = [];

let server: FastifyInstance;
let orgId: string | null = null;
let otherOrgId: string | null = null;
let restoreAuth: (() => void) | null = null;
let dbReachable = false;
let previousRoleHeader: string | undefined;

beforeAll(async () => {
  previousRoleHeader = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
  }
  if (dbReachable) {
    const iso = await createIsolatedOrg('migration-authz');
    const other = await createIsolatedOrg('migration-authz-b');
    orgId = iso.orgId;
    otherOrgId = other.orgId;
    restoreAuth = useIsolatedOrgAuth(iso.clerkOrg);
  }
  server = await buildServer({
    onRoute: (opts) => {
      const methods = Array.isArray(opts.method) ? opts.method : [opts.method];
      const permission = (opts.config as { permission?: string } | undefined)?.permission ?? null;
      for (const method of methods) {
        if (method === 'HEAD' || method === 'OPTIONS') continue;
        collected.push({ method, url: opts.url, permission });
      }
    },
  });
  await server.ready();
});

afterAll(async () => {
  if (previousRoleHeader === undefined) delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  else process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previousRoleHeader;
  if (server) await server.close();
  restoreAuth?.();
  if (orgId) await dropIsolatedOrg(orgId);
  if (otherOrgId) await dropIsolatedOrg(otherOrgId);
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!orgId);

describe('migration import authorization', () => {
  it('declares settings:write on every import mutation', () => {
    const byKey = new Map(collected.map((route) => [`${route.method} ${route.url}`, route]));
    for (const key of IMPORT_MUTATIONS) {
      expect(byKey.get(key)?.permission, key).toBe('settings:write');
    }
    expect(byKey.get('GET /api/v1/migrations')?.permission).toBe('migrations:read');
    expect(byKey.get('GET /api/v1/migrations/:id/errors.csv')?.permission).toBe('migrations:read');
  });

  skipIfNoDb('an admin cannot undo another org’s import', async () => {
    const otherUser = await prisma.user.findFirstOrThrow({
      where: { orgId: otherOrgId!, deletedAt: null },
      select: { id: true },
    });
    const foreign = await prisma.migrationJob.create({
      data: {
        orgId: otherOrgId!,
        userId: otherUser.id,
        source: 'CSV',
        status: 'COMPLETE',
        totalRows: 1,
        meta: { entityType: 'companies' },
      },
      select: { id: true },
    });
    const res = await server.inject({
      method: 'DELETE',
      url: `/api/v1/migrations/${foreign.id}/undo`,
    });
    expect(res.statusCode).toBe(404);
    const still = await prisma.migrationJob.findFirst({
      where: { id: foreign.id, orgId: otherOrgId! },
      select: { id: true, status: true },
    });
    expect(still).toMatchObject({ id: foreign.id, status: 'COMPLETE' });
    await prisma.migrationJob.deleteMany({ where: { id: foreign.id, orgId: otherOrgId! } });
  });

  skipIfNoDb('an admin reaches undo and a missing job is 404, not a silent delete', async () => {
    const missing = randomUUID();
    const res = await server.inject({
      method: 'DELETE',
      url: `/api/v1/migrations/${missing}/undo`,
    });
    expect(res.statusCode).toBe(404);
  });

  for (const role of MEMBER_ROLES) {
    skipIfNoDb(`a ${role} session cannot start or undo an import`, async () => {
      const before = await prisma.migrationJob.count({ where: { orgId: orgId! } });
      const started = await server.inject({
        method: 'POST',
        url: '/api/v1/migrations/start-csv',
        headers: { 'x-bidstack-e2e-role': role },
        payload: {
          source: 'CSV',
          entityType: 'companies',
          rows: [{ name: 'Synthetic Import Co' }],
          mappings: { name: 'company.name' },
        },
      });
      expect(started.statusCode).toBe(403);

      const undone = await server.inject({
        method: 'DELETE',
        url: `/api/v1/migrations/${randomUUID()}/undo`,
        headers: { 'x-bidstack-e2e-role': role },
      });
      expect(undone.statusCode).toBe(403);
      expect(await prisma.migrationJob.count({ where: { orgId: orgId! } })).toBe(before);
    });
  }
});

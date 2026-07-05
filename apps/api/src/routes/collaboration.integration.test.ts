// Integration tests for POST /api/v1/comments — the FK-graft guard (B3).
//
// WHY these assertions matter:
//   - Comment.targetId is a polymorphic reference with no DB-level FK, so the
//     org-ownership check in the route is the ONLY thing stopping an org
//     member from planting comments (and @mention notification deep links)
//     against another tenant's record ids;
//   - missing and cross-org targets must be indistinguishable (both generic
//     404) or the endpoint becomes an existence oracle for foreign ids;
//   - unknown target types must fail closed, otherwise the guard is bypassed
//     by mistyping targetType.

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId = '';
let ownCompanyId = '';
let otherOrgId = '';
let otherCompanyId = '';
let restoreAuth: (() => void) | undefined;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const org = await createIsolatedOrg('collab');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);

  const ownCompany = await prisma.company.create({
    data: { orgId, name: `CollabOwn-${randomUUID().slice(0, 8)}`, source: 'manual' },
  });
  ownCompanyId = ownCompany.id;

  const other = await prisma.org.create({
    data: { clerkOrg: `org_collab_${randomUUID().slice(0, 8)}`, name: 'Collab Other' },
  });
  otherOrgId = other.id;
  otherCompanyId = (
    await prisma.company.create({
      data: { orgId: other.id, name: 'collab-foreign', source: 'manual' },
    })
  ).id;

  server = await buildServer();
  await server.ready();
}, 30_000);

afterAll(async () => {
  if (server) await server.close();
  if (!dbReachable) return;
  try {
    await prisma.comment.deleteMany({ where: { orgId } });
    if (ownCompanyId) await prisma.company.deleteMany({ where: { id: ownCompanyId } });
    if (otherOrgId) await prisma.org.deleteMany({ where: { id: otherOrgId } });
  } catch {
    /* ignore */
  }
  restoreAuth?.();
  if (orgId) await dropIsolatedOrg(orgId);
  await prisma.$disconnect();
}, 30_000);

const t = makeSkipIfNoDb(() => dbReachable && !!orgId);

describe('POST /comments — FK-graft guard on the polymorphic target', () => {
  t('accepts a comment on a record in the caller org (control)', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/comments',
      payload: { targetType: 'account', targetId: ownCompanyId, bodyMd: 'own-org comment' },
    });
    expect(res.statusCode).toBe(201);
  });

  t('rejects a cross-org target id with 404 and persists nothing', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/comments',
      payload: { targetType: 'account', targetId: otherCompanyId, bodyMd: 'cross-org graft' },
    });
    expect(res.statusCode).toBe(404);
    // The graft must not be persisted in EITHER org — a planted comment would
    // surface to org B's users via GET /comments on their own record.
    expect(await prisma.comment.count({ where: { targetId: otherCompanyId } })).toBe(0);
  });

  t('cross-org and nonexistent targets are indistinguishable (no existence oracle)', async () => {
    const crossOrg = await server.inject({
      method: 'POST',
      url: '/api/v1/comments',
      payload: { targetType: 'account', targetId: otherCompanyId, bodyMd: 'probe' },
    });
    const missing = await server.inject({
      method: 'POST',
      url: '/api/v1/comments',
      payload: { targetType: 'account', targetId: randomUUID(), bodyMd: 'probe' },
    });
    expect(crossOrg.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(crossOrg.body).toBe(missing.body);
  });

  t('unknown target types fail closed with 404', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/comments',
      payload: { targetType: 'gizmo', targetId: ownCompanyId, bodyMd: 'unknown type' },
    });
    expect(res.statusCode).toBe(404);
  });
});

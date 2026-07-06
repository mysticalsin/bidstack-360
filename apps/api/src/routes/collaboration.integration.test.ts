// Integration tests for POST /api/v1/comments — the RBAC gate + FK-graft guard.
//
// WHY these assertions matter:
//   - RBAC: comments were the one org-visible mutation surface with no
//     permission gate — a Read-Only viewer could author comments and fire
//     @mention notifications to other users. The plugin-level gate must reject a
//     comments:write-lacking caller (403) yet still admit permitted roles (201);
//   - Comment.targetId AND parentId are polymorphic references with no DB-level
//     FK, so the org-ownership checks in the route are the ONLY thing stopping an
//     org member from planting comments (and @mention deep links) — or grafting a
//     reply onto another tenant's comment — using foreign ids;
//   - missing and cross-org targets/parents must be indistinguishable (both
//     generic 404) or the endpoint becomes an existence oracle for foreign ids;
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
let foreignParentId = '';
let restoreAuth: (() => void) | undefined;
let previousStubRoleHeader: string | undefined;

beforeAll(async () => {
  // Enable the loopback-only stub role-override header so a case can drive the
  // gate as a specific role (Read-Only) instead of the isolated org's Admin.
  previousStubRoleHeader = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';

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

  // A real comment living in org B, used as a cross-org parentId graft target.
  // authorUserId is a required FK, so mint a throwaway user in org B for it.
  const foreignAuthor = await prisma.user.create({
    data: {
      orgId: otherOrgId,
      clerkUser: `u_collab_${randomUUID().slice(0, 8)}`,
      email: `foreign-${randomUUID().slice(0, 8)}@test.local`,
      name: 'Foreign Author',
      role: 'member',
    },
  });
  foreignParentId = (
    await prisma.comment.create({
      data: {
        orgId: otherOrgId,
        targetType: 'account',
        // Distinct random targetId (parentId is polymorphic with no FK) so this
        // seed row does not collide with the cross-org-target test's global
        // `targetId: otherCompanyId` count assertion.
        targetId: randomUUID(),
        authorUserId: foreignAuthor.id,
        bodyMd: 'foreign parent',
      },
    })
  ).id;

  server = await buildServer();
  await server.ready();
}, 30_000);

afterAll(async () => {
  if (server) await server.close();
  if (dbReachable) {
    try {
      await prisma.comment.deleteMany({ where: { orgId } });
      if (ownCompanyId) await prisma.company.deleteMany({ where: { id: ownCompanyId } });
      // Org B delete cascades its comment + throwaway user.
      if (otherOrgId) await prisma.org.deleteMany({ where: { id: otherOrgId } });
    } catch {
      /* ignore */
    }
    restoreAuth?.();
    if (orgId) await dropIsolatedOrg(orgId);
    await prisma.$disconnect();
  }
  if (previousStubRoleHeader === undefined) delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  else process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previousStubRoleHeader;
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

describe('POST /comments — RBAC gate (comments:write)', () => {
  t('a Read-Only role is refused with 403 and persists nothing', async () => {
    // Read-Only holds comments:read but NOT comments:write, so it must be denied
    // at the plugin gate BEFORE any DB write — otherwise a viewer could author
    // org-visible comments and fire @mention notifications. The target is a
    // valid own-org record, so the ONLY reason for failure is the write gate.
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/comments',
      headers: { 'x-bidstack-e2e-role': 'read-only' },
      payload: { targetType: 'account', targetId: ownCompanyId, bodyMd: 'read-only should 403' },
    });
    expect(res.statusCode).toBe(403);
    expect(
      await prisma.comment.count({ where: { orgId, bodyMd: 'read-only should 403' } }),
    ).toBe(0);
  });

  t('a permitted role (Admin) may author a comment (201)', async () => {
    // Default isolated-org identity is Admin, which holds comments:write — the
    // gate must admit it. Pins that the new gate does not lock out legitimate
    // authors (the deny path above would otherwise be trivially satisfiable by a
    // gate that rejects everyone).
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/comments',
      headers: { 'x-bidstack-e2e-role': 'admin' },
      payload: { targetType: 'account', targetId: ownCompanyId, bodyMd: 'admin may write' },
    });
    expect(res.statusCode).toBe(201);
  });

  t('a Read-Only role may still update its own presence (self-scoped, comments:read)', async () => {
    // The gate carve-out: presence is a generic collaboration primitive keyed on
    // the caller's own userId, not comment authoring. A Read-Only viewer must be
    // able to broadcast presence — a blanket "POST needs comments:write" gate
    // would wrongly 403 this. Encodes WHY the self-scoped exception exists.
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/presence',
      headers: { 'x-bidstack-e2e-role': 'read-only' },
      payload: { status: 'online' },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('POST /comments — FK-graft guard on the reply parent', () => {
  t('rejects a cross-org parentId with 404 and persists nothing', async () => {
    // Own-org target is valid; only the parentId points at an org-B comment.
    // Without the parent org check the reply would be grafted onto a foreign
    // thread. Must 404 (same generic message as a bad target — no oracle).
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/comments',
      payload: {
        targetType: 'account',
        targetId: ownCompanyId,
        bodyMd: 'cross-org parent graft',
        parentId: foreignParentId,
      },
    });
    expect(res.statusCode).toBe(404);
    expect(
      await prisma.comment.count({ where: { orgId, bodyMd: 'cross-org parent graft' } }),
    ).toBe(0);
  });

  t('accepts a reply to a parent in the same org + thread (control)', async () => {
    const parent = await server.inject({
      method: 'POST',
      url: '/api/v1/comments',
      payload: { targetType: 'account', targetId: ownCompanyId, bodyMd: 'parent comment' },
    });
    expect(parent.statusCode).toBe(201);
    const parentId = (parent.json() as { id: string }).id;

    const reply = await server.inject({
      method: 'POST',
      url: '/api/v1/comments',
      payload: { targetType: 'account', targetId: ownCompanyId, bodyMd: 'reply', parentId },
    });
    expect(reply.statusCode).toBe(201);
    expect((reply.json() as { parentId: string | null }).parentId).toBe(parentId);
  });
});

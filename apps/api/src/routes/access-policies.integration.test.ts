/**
 * Access policies (factory slice 5): drafts, impact simulation over the last
 * 7 days of audit events, the two-admin approval queue, versioned publish and
 * rollback, audit rows for every decision, tenant isolation, and enforcement
 * behind ACCESS_POLICIES_ENFORCE that can only narrow the RBAC matrix.
 *
 * The org visitor is the author. The stub role header "admin" is a second,
 * distinct Admin user and plays the approver.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma, type Prisma } from '@bidstack/db';

import { invalidateAccessPolicyCache } from '../lib/access-policy-enforcement.js';
import { buildServer } from '../server.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../test-support/isolated-org.js';

const SECOND_ADMIN = { 'x-bidstack-e2e-role': 'admin' };
const MANAGER = { 'x-bidstack-e2e-role': 'manager' };
const READ_ONLY = { 'x-bidstack-e2e-role': 'read-only' };
const DAY = 24 * 60 * 60 * 1000;

let server: Awaited<ReturnType<typeof buildServer>>;
let orgId = '';
let foreignOrgId = '';
let foreignPolicyId = '';
let restoreAuth: (() => void) | null = null;
let previousRoleHeader: string | undefined;
let previousEnforce: string | undefined;
let sellerId = '';
let frCompanyId = '';
let deCompanyId = '';

const DENY_DE_WRITES = [
  {
    id: 'no-de-writes',
    effect: 'deny',
    when: { teams: ['France'] },
    then: { actions: ['companies:write'], resources: ['companies'] },
    conditions: { countries: ['DE'] },
  },
];

async function auditCount(action: string): Promise<number> {
  return prisma.auditLog.count({ where: { orgId, action } });
}

async function updatedAt(id: string): Promise<string> {
  return (await prisma.accessPolicyVersion.findUniqueOrThrow({ where: { id } })).updatedAt.toISOString();
}

async function decide(id: string, decision: 'approve' | 'reject', note = 'ok', headers = SECOND_ADMIN, seen?: string) {
  return server.inject({
    method: 'POST',
    url: `/api/v1/access-policies/${id}/${decision}`,
    headers,
    payload: { note, expectedUpdatedAt: seen ?? (await updatedAt(id)) },
  });
}

async function createDraft(name: string, rules: unknown): Promise<string> {
  const res = await server.inject({ method: 'POST', url: '/api/v1/access-policies', payload: { name, rules } });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

async function publishRules(name: string, rules: unknown): Promise<{ id: string; version: number }> {
  const id = await createDraft(name, rules);
  expect((await server.inject({ method: 'POST', url: `/api/v1/access-policies/${id}/submit` })).statusCode).toBe(200);
  const approved = await decide(id, 'approve');
  expect(approved.statusCode, approved.body).toBe(200);
  const published = await server.inject({ method: 'POST', url: `/api/v1/access-policies/${id}/publish` });
  expect(published.statusCode, published.body).toBe(200);
  return { id, version: published.json().version as number };
}

beforeAll(async () => {
  previousRoleHeader = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  previousEnforce = process.env.ACCESS_POLICIES_ENFORCE;
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
  delete process.env.ACCESS_POLICIES_ENFORCE;

  const org = await createIsolatedOrg('policies');
  const foreign = await createIsolatedOrg('policies-foreign');
  orgId = org.orgId;
  foreignOrgId = foreign.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  server = await buildServer();

  // The seller needs companies:write in the matrix, or no draft could change
  // the outcome of their company.update events.
  const salesRole = await prisma.role.findFirstOrThrow({ where: { orgId, name: 'Admin' } });
  const seller = await prisma.user.create({
    data: { orgId, clerkUser: `seller_${randomUUID()}`, email: `seller.${randomUUID()}@test.local`, name: 'Fran Seller', role: 'member' },
  });
  sellerId = seller.id;
  await prisma.userRole.create({ data: { orgId, userId: sellerId, roleId: salesRole.id } });
  const group = await prisma.userGroup.create({ data: { orgId, name: 'France', scopeCountries: ['FR'] } });
  await prisma.userGroupMember.create({ data: { orgId, groupId: group.id, userId: sellerId } });

  frCompanyId = (await prisma.company.create({ data: { orgId, name: `FR Co ${randomUUID()}`, countryCode: 'FR' } })).id;
  deCompanyId = (await prisma.company.create({ data: { orgId, name: `DE Co ${randomUUID()}`, countryCode: 'DE' } })).id;

  const now = Date.now();
  const events: Array<{ org: string; target: string; daysAgo: number }> = [
    { org: orgId, target: frCompanyId, daysAgo: 1 },
    { org: orgId, target: frCompanyId, daysAgo: 2 },
    { org: orgId, target: frCompanyId, daysAgo: 3 },
    { org: orgId, target: deCompanyId, daysAgo: 1 },
    { org: orgId, target: deCompanyId, daysAgo: 4 },
    { org: orgId, target: deCompanyId, daysAgo: 10 },
  ];
  for (const e of events) {
    await prisma.auditLog.create({
      data: {
        orgId: e.org,
        userId: sellerId,
        action: 'company.update',
        targetType: 'company',
        targetId: e.target,
        at: new Date(now - e.daysAgo * DAY),
      },
    });
  }

  const foreignAdmin = await prisma.user.findFirstOrThrow({ where: { orgId: foreignOrgId }, orderBy: { createdAt: 'asc' } });
  foreignPolicyId = (
    await prisma.accessPolicyVersion.create({
      data: { orgId: foreignOrgId, name: 'Foreign draft', status: 'pending', rules: [], createdById: foreignAdmin.id },
    })
  ).id;
});

afterAll(async () => {
  await server?.close();
  restoreAuth?.();
  if (previousRoleHeader === undefined) delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  else process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previousRoleHeader;
  if (previousEnforce === undefined) delete process.env.ACCESS_POLICIES_ENFORCE;
  else process.env.ACCESS_POLICIES_ENFORCE = previousEnforce;
  await dropIsolatedOrg(orgId);
  await dropIsolatedOrg(foreignOrgId);
});

describe('access policy permissions', () => {
  it('keeps policies Admin-only: a read-only user can neither list nor draft one', async () => {
    const list = await server.inject({ method: 'GET', url: '/api/v1/access-policies', headers: READ_ONLY });
    expect(list.statusCode).toBe(403);
    const own = await server.inject({ method: 'GET', url: '/api/v1/access-policies' });
    expect(own.json()).toMatchObject({ enforcement: false, published: null });
    const create = await server.inject({
      method: 'POST',
      url: '/api/v1/access-policies',
      headers: READ_ONLY,
      payload: { name: 'x', rules: [] },
    });
    expect(create.statusCode).toBe(403);
  });

  it('refuses drafting and simulation to a Sales Manager', async () => {
    const create = await server.inject({ method: 'POST', url: '/api/v1/access-policies', headers: MANAGER, payload: { name: 'x', rules: [] } });
    expect(create.statusCode).toBe(403);
    const sim = await server.inject({ method: 'POST', url: '/api/v1/access-policies/simulate', headers: MANAGER, payload: { rules: [] } });
    expect(sim.statusCode).toBe(403);
  });
});

describe('drafts and simulation', () => {
  it('creates a draft, audits it and rejects an action outside the resource', async () => {
    const before = await auditCount('access_policy.create');
    const id = await createDraft('No DE writes', DENY_DE_WRITES);
    const row = await prisma.accessPolicyVersion.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ orgId, status: 'draft', version: null });
    expect(await auditCount('access_policy.create')).toBe(before + 1);

    const bad = await server.inject({
      method: 'POST',
      url: '/api/v1/access-policies',
      payload: { name: 'bad', rules: [{ ...DENY_DE_WRITES[0], then: { actions: ['leads:read'], resources: ['companies'] } }] },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('simulates a draft against the last 7 days of audit events only', async () => {
    const res = await server.inject({ method: 'POST', url: '/api/v1/access-policies/simulate', payload: { rules: DENY_DE_WRITES } });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.evaluated).toBe(5);
    expect(body.lost.count).toBe(2);
    expect(body.gained.count).toBe(0);
    expect(body.lost.users).toEqual([expect.objectContaining({ userId: sellerId, name: 'Fran Seller', count: 2 })]);
    expect(body.lost.examples.map((e: { targetId: string }) => e.targetId)).toEqual([deCompanyId, deCompanyId]);
    expect(body.lost.examples[0]).toMatchObject({ action: 'companies:write', resource: 'companies', ruleId: 'no-de-writes' });
    expect(body.byDay).toHaveLength(7);
    expect(body.byDay.reduce((n: number, d: { lost: number }) => n + d.lost, 0)).toBe(2);
    expect(new Date(body.window.to).getTime() - new Date(body.window.from).getTime()).toBe(7 * DAY);
  });

  it('an empty draft against no published policy changes nothing', async () => {
    const res = await server.inject({ method: 'POST', url: '/api/v1/access-policies/simulate', payload: { rules: [] } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ gained: { count: 0 }, lost: { count: 0 } });
  });
});

describe('approval queue, publish and rollback', () => {
  let firstId = '';

  it('moves a draft to pending and never lets the author approve it', async () => {
    firstId = await createDraft('First', DENY_DE_WRITES);
    const submitted = await server.inject({ method: 'POST', url: `/api/v1/access-policies/${firstId}/submit` });
    expect(submitted.statusCode, submitted.body).toBe(200);
    expect(submitted.json().status).toBe('pending');
    expect(await auditCount('access_policy.submit')).toBeGreaterThanOrEqual(1);

    const self = await decide(firstId, 'approve', 'mine', {});
    expect(self.statusCode, self.body).toBe(403);
    expect((await prisma.accessPolicyVersion.findUniqueOrThrow({ where: { id: firstId } })).status).toBe('pending');
  });

  it('refuses to publish before approval, then a second admin approves', async () => {
    const early = await server.inject({ method: 'POST', url: `/api/v1/access-policies/${firstId}/publish` });
    expect(early.statusCode).toBe(409);

    const before = await auditCount('access_policy.approve');
    const approved = await decide(firstId, 'approve', 'Checked the impact preview');
    expect(approved.statusCode, approved.body).toBe(200);
    const row = await prisma.accessPolicyVersion.findUniqueOrThrow({ where: { id: firstId } });
    expect(row.status).toBe('approved');
    expect(row.approvedById).not.toBe(row.createdById);
    expect(await auditCount('access_policy.approve')).toBe(before + 1);
  });

  it('publishes v1, then v2 supersedes it, and a rollback request needs a second admin before it is v3', async () => {
    const pub = await server.inject({ method: 'POST', url: `/api/v1/access-policies/${firstId}/publish` });
    expect(pub.statusCode, pub.body).toBe(200);
    expect(pub.json()).toMatchObject({ status: 'published', version: 1 });

    const second = await publishRules('Second', []);
    expect(second.version).toBe(2);
    expect((await prisma.accessPolicyVersion.findUniqueOrThrow({ where: { id: firstId } })).status).toBe('superseded');

    const edit = await server.inject({ method: 'PATCH', url: `/api/v1/access-policies/${second.id}`, payload: { name: 'Edited' } });
    expect(edit.statusCode).toBe(409);

    const rollback = await server.inject({ method: 'POST', url: `/api/v1/access-policies/${firstId}/rollback` });
    expect(rollback.statusCode, rollback.body).toBe(201);
    const request = rollback.json();
    expect(request).toMatchObject({ status: 'pending', version: null, rollbackOfId: firstId, name: 'Rollback to v1' });
    expect(request.rules).toEqual((await prisma.accessPolicyVersion.findUniqueOrThrow({ where: { id: firstId } })).rules);
    // Nothing changes until a second admin approves: v2 stays live.
    expect((await prisma.accessPolicyVersion.findUniqueOrThrow({ where: { id: second.id } })).status).toBe('published');
    expect((await decide(request.id, 'approve', 'mine', {})).statusCode).toBe(403);
    expect((await decide(request.id, 'approve')).statusCode).toBe(200);
    const v3 = await server.inject({ method: 'POST', url: `/api/v1/access-policies/${request.id}/publish` });
    expect(v3.statusCode, v3.body).toBe(200);
    expect(v3.json()).toMatchObject({ status: 'published', version: 3, rollbackOfId: firstId });
    expect((await prisma.accessPolicyVersion.findUniqueOrThrow({ where: { id: second.id } })).status).toBe('superseded');

    const list = await server.inject({ method: 'GET', url: '/api/v1/access-policies' });
    expect(list.json().published).toMatchObject({ version: 3 });
    expect(await prisma.accessPolicyVersion.count({ where: { orgId, status: 'published' } })).toBe(1);
  });

  it('reports gains when a draft relaxes the published policy', async () => {
    const res = await server.inject({ method: 'POST', url: '/api/v1/access-policies/simulate', payload: { rules: [] } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ gained: { count: 2 }, lost: { count: 0 }, baselineVersion: 3 });
  });

  it('writes every decision and publish to the hash-chained audit log', async () => {
    const rows = await prisma.auditLog.findMany({
      where: { orgId, action: { startsWith: 'access_policy.' } },
      orderBy: { id: 'asc' },
    });
    const actions = new Set(rows.map((r) => r.action));
    for (const a of ['create', 'submit', 'approve', 'publish', 'rollback_request']) {
      expect(actions).toContain(`access_policy.${a}`);
    }
    expect(rows.every((r) => r.targetType === 'access_policy' && typeof r.rowHash === 'string')).toBe(true);
  });

  it('records a rejection with its note and returns the draft for edits', async () => {
    const id = await createDraft('To reject', DENY_DE_WRITES);
    await server.inject({ method: 'POST', url: `/api/v1/access-policies/${id}/submit` });
    const rejected = await decide(id, 'reject', 'Too broad');
    expect(rejected.statusCode, rejected.body).toBe(200);
    expect(rejected.json()).toMatchObject({ status: 'rejected', decisionNote: 'Too broad' });
    expect(await auditCount('access_policy.reject')).toBe(1);
    const edit = await server.inject({ method: 'PATCH', url: `/api/v1/access-policies/${id}`, payload: { name: 'Narrower' } });
    expect(edit.statusCode).toBe(200);
    expect(edit.json()).toMatchObject({ status: 'draft', decisionNote: null, approvedById: null });
  });

  it('only the author edits or submits, so a reviewer never approves rules they wrote', async () => {
    const id = await createDraft('Authored', DENY_DE_WRITES);
    const edit = await server.inject({
      method: 'PATCH',
      url: `/api/v1/access-policies/${id}`,
      headers: SECOND_ADMIN,
      payload: { rules: [] },
    });
    expect(edit.statusCode).toBe(403);
    const submit = await server.inject({ method: 'POST', url: `/api/v1/access-policies/${id}/submit`, headers: SECOND_ADMIN });
    expect(submit.statusCode).toBe(403);
    expect((await prisma.accessPolicyVersion.findUniqueOrThrow({ where: { id } })).status).toBe('draft');
  });

  it('refuses a decision on rules the reviewer did not see', async () => {
    const id = await createDraft('Changes under review', DENY_DE_WRITES);
    await server.inject({ method: 'POST', url: `/api/v1/access-policies/${id}/submit` });
    const seen = await updatedAt(id);
    const withdraw = await server.inject({ method: 'POST', url: `/api/v1/access-policies/${id}/withdraw` });
    expect(withdraw.statusCode, withdraw.body).toBe(200);
    expect(withdraw.json().status).toBe('draft');
    expect(await auditCount('access_policy.withdraw')).toBeGreaterThanOrEqual(1);
    await server.inject({ method: 'PATCH', url: `/api/v1/access-policies/${id}`, payload: { rules: [] } });
    await server.inject({ method: 'POST', url: `/api/v1/access-policies/${id}/submit` });
    const stale = await decide(id, 'approve', 'ok', SECOND_ADMIN, seen);
    expect(stale.statusCode).toBe(409);
    expect((await prisma.accessPolicyVersion.findUniqueOrThrow({ where: { id } })).status).toBe('pending');
  });

  it('lets only one of two concurrent decisions win', async () => {
    const id = await createDraft('Raced', DENY_DE_WRITES);
    await server.inject({ method: 'POST', url: `/api/v1/access-policies/${id}/submit` });
    const seen = await updatedAt(id);
    const before = (await auditCount('access_policy.approve')) + (await auditCount('access_policy.reject'));
    const results = await Promise.all([
      decide(id, 'approve', 'yes', SECOND_ADMIN, seen),
      decide(id, 'reject', 'no', SECOND_ADMIN, seen),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const after = (await auditCount('access_policy.approve')) + (await auditCount('access_policy.reject'));
    expect(after).toBe(before + 1);
  });
});

describe('database guards', () => {
  it('keeps the one-published index and refuses approval by the submitter', async () => {
    const idx = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'access_policy_versions'
        AND indexname = 'access_policy_versions_one_published_idx'`;
    expect(idx).toHaveLength(1);
    const author = await prisma.user.findFirstOrThrow({ where: { orgId }, orderBy: { createdAt: 'asc' } });
    const row = await prisma.accessPolicyVersion.create({
      data: { orgId, name: 'Guard', status: 'pending', rules: [], createdById: sellerId, submittedById: author.id },
    });
    await expect(
      prisma.accessPolicyVersion.update({ where: { id: row.id }, data: { status: 'approved', approvedById: author.id } }),
    ).rejects.toThrow();
    await prisma.accessPolicyVersion.delete({ where: { id: row.id } });
  });
});

describe('tenant isolation', () => {
  it('never exposes or changes another org policy', async () => {
    const list = await server.inject({ method: 'GET', url: '/api/v1/access-policies' });
    expect(list.json().items.map((p: { id: string }) => p.id)).not.toContain(foreignPolicyId);
    for (const action of ['approve', 'reject', 'publish', 'rollback', 'submit']) {
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/access-policies/${foreignPolicyId}/${action}`,
        headers: SECOND_ADMIN,
        ...(action === 'approve' || action === 'reject'
          ? { payload: { note: 'x', expectedUpdatedAt: new Date().toISOString() } }
          : {}),
      });
      expect(res.statusCode, action).toBe(404);
    }
    const patch = await server.inject({ method: 'PATCH', url: `/api/v1/access-policies/${foreignPolicyId}`, payload: { name: 'x' } });
    expect(patch.statusCode).toBe(404);
    expect((await prisma.accessPolicyVersion.findUniqueOrThrow({ where: { id: foreignPolicyId } })).status).toBe('pending');
  });
});

describe('enforcement behind ACCESS_POLICIES_ENFORCE', () => {
  const missing = randomUUID();

  beforeAll(async () => {
    await publishRules('Enforced', [
      {
        id: 'no-sales-opp-writes',
        effect: 'deny',
        when: { roles: ['Sales Manager'] },
        then: { actions: ['opportunities:write'], resources: ['opportunities'] },
      },
      // Once an allow rule covers an action, anyone it does not match is
      // default-denied, so Admin is listed to keep its own access.
      {
        id: 'try-to-widen',
        effect: 'allow',
        when: { roles: ['Read-Only', 'Admin'] },
        then: { actions: ['opportunities:write'], resources: ['opportunities'] },
      },
    ]);
  });

  afterAll(() => {
    delete process.env.ACCESS_POLICIES_ENFORCE;
  });

  it('is off by default: the published deny rule does not block', async () => {
    const res = await server.inject({ method: 'DELETE', url: `/api/v1/opportunities/${missing}`, headers: MANAGER });
    expect(res.statusCode).toBe(404);
  });

  it('narrows the matrix when the flag is on', async () => {
    process.env.ACCESS_POLICIES_ENFORCE = 'true';
    const res = await server.inject({ method: 'DELETE', url: `/api/v1/opportunities/${missing}`, headers: MANAGER });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/access policy/i);
    const admin = await server.inject({ method: 'DELETE', url: `/api/v1/opportunities/${missing}` });
    expect(admin.statusCode).toBe(404);
    const list = await server.inject({ method: 'GET', url: '/api/v1/access-policies' });
    expect(list.json().enforcement).toBe(true);
  });

  it('never widens: an allow rule cannot grant what the matrix denies', async () => {
    process.env.ACCESS_POLICIES_ENFORCE = 'true';
    const res = await server.inject({ method: 'DELETE', url: `/api/v1/opportunities/${missing}`, headers: READ_ONLY });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/Requires permission: opportunities:write/);
  });

  it('fails closed when the stored rules no longer validate', async () => {
    process.env.ACCESS_POLICIES_ENFORCE = 'true';
    const live = await prisma.accessPolicyVersion.findFirstOrThrow({ where: { orgId, status: 'published' } });
    await prisma.accessPolicyVersion.update({ where: { id: live.id }, data: { rules: [{ id: 'broken' }] } });
    invalidateAccessPolicyCache(orgId);
    try {
      const res = await server.inject({ method: 'DELETE', url: `/api/v1/opportunities/${missing}` });
      expect(res.statusCode).toBe(403);
      expect(res.json().message).toMatch(/failed validation/);
    } finally {
      await prisma.accessPolicyVersion.update({ where: { id: live.id }, data: { rules: live.rules as Prisma.InputJsonValue } });
      invalidateAccessPolicyCache(orgId);
    }
  });
});

describe('list response', () => {
  it('still reports the live version behind more than a page of drafts', async () => {
    const author = await prisma.user.findFirstOrThrow({ where: { orgId }, orderBy: { createdAt: 'asc' } });
    await prisma.accessPolicyVersion.createMany({
      data: Array.from({ length: 101 }, (_, i) => ({ orgId, name: `Bulk ${i}`, rules: [], createdById: author.id })),
    });
    const list = await server.inject({ method: 'GET', url: '/api/v1/access-policies' });
    expect(list.statusCode).toBe(200);
    expect(list.json().items).toHaveLength(100);
    expect(list.json().published).not.toBeNull();
  });
});

// Cross-org IDOR sweep over write routes the route inventory flagged as
// untested. The caller is an admin of org A; every target id belongs to org B.
// Each write must answer 404 (the id does not exist for this caller) and leave
// org B's row untouched. Also pins that a soft-deleted email template cannot
// be edited or deleted again.
import { createHash, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgA: string | null = null;
let orgB: string | null = null;
let restoreAuth: (() => void) | null = null;
let previousStubRoleHeader: string | undefined;

const ids = {
  userB: '',
  userBRole: '',
  apiKeyB: '',
  workflowB: '',
  templateB: '',
  stageB: '',
  stageBName: '',
  deletedTemplateA: '',
};

beforeAll(async () => {
  previousStubRoleHeader = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const a = await createIsolatedOrg('idor-a');
  const b = await createIsolatedOrg('idor-b');
  orgA = a.orgId;
  orgB = b.orgId;
  restoreAuth = useIsolatedOrgAuth(a.clerkOrg);

  const userB = await prisma.user.findFirstOrThrow({ where: { orgId: orgB }, orderBy: { createdAt: 'asc' } });
  ids.userB = userB.id;
  ids.userBRole = userB.role;

  const rawKey = `bs_idor_${randomUUID()}`;
  ids.apiKeyB = (
    await prisma.apiKey.create({
      data: {
        orgId: orgB,
        name: 'org B key',
        prefix: rawKey.slice(0, 8),
        hashedKey: createHash('sha256').update(rawKey).digest('hex'),
        scopes: ['read'],
      },
    })
  ).id;

  ids.workflowB = (
    await prisma.workflow.create({
      data: { orgId: orgB, name: 'org B workflow', triggerKind: 'manual' },
    })
  ).id;

  ids.templateB = (
    await prisma.emailTemplate.create({
      data: { orgId: orgB, name: `org B template ${randomUUID()}`, subject: 's', bodyHtml: '<p>b</p>' },
    })
  ).id;

  const pipelineB = await prisma.pipeline.create({ data: { orgId: orgB, name: `org B pipeline ${randomUUID()}` } });
  const stageB = await prisma.pipelineStage.create({
    data: { orgId: orgB, pipelineId: pipelineB.id, key: 'qualify', name: 'Qualify' },
  });
  ids.stageB = stageB.id;
  ids.stageBName = stageB.name;

  ids.deletedTemplateA = (
    await prisma.emailTemplate.create({
      data: {
        orgId: orgA,
        name: `deleted template ${randomUUID()}`,
        subject: 's',
        bodyHtml: '<p>a</p>',
        deletedAt: new Date(),
      },
    })
  ).id;

  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (server) await server.close();
  if (restoreAuth) restoreAuth();
  if (orgA) await dropIsolatedOrg(orgA);
  if (orgB) await dropIsolatedOrg(orgB);
  if (dbReachable) await prisma.$disconnect();
  if (previousStubRoleHeader === undefined) delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  else process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previousStubRoleHeader;
});

const t = makeSkipIfNoDb(() => dbReachable && !!orgA && !!orgB);
const admin = { 'x-bidstack-e2e-role': 'admin' };

describe('cross-org writes answer 404 and leave the other org untouched', () => {
  t('PATCH /users/:id/role', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/v1/users/${ids.userB}/role`,
      headers: admin,
      payload: { role: ids.userBRole === 'admin' ? 'member' : 'admin' },
    });
    expect(res.statusCode).toBe(404);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: ids.userB } });
    expect(after.role).toBe(ids.userBRole);
  });

  t('PATCH /users/:id/role needs admin', async () => {
    const self = await prisma.user.findFirstOrThrow({ where: { orgId: orgA! } });
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/v1/users/${self.id}/role`,
      headers: { 'x-bidstack-e2e-role': 'account-executive' },
      payload: { role: 'admin' },
    });
    expect(res.statusCode).toBe(403);
  });

  t('DELETE /integrations/api-keys/:id', async () => {
    const res = await server.inject({
      method: 'DELETE',
      url: `/api/v1/integrations/api-keys/${ids.apiKeyB}`,
      headers: admin,
    });
    expect(res.statusCode).toBe(404);
    const after = await prisma.apiKey.findUniqueOrThrow({ where: { id: ids.apiKeyB } });
    expect(after.revokedAt).toBeNull();
  });

  t('PATCH, run and DELETE /workflows/:id', async () => {
    const patch = await server.inject({
      method: 'PATCH',
      url: `/api/v1/workflows/${ids.workflowB}`,
      headers: admin,
      payload: { name: 'hijacked' },
    });
    expect(patch.statusCode).toBe(404);
    const run = await server.inject({
      method: 'POST',
      url: `/api/v1/workflows/${ids.workflowB}/run`,
      headers: admin,
      payload: { input: {} },
    });
    expect(run.statusCode).toBe(404);
    const del = await server.inject({
      method: 'DELETE',
      url: `/api/v1/workflows/${ids.workflowB}`,
      headers: admin,
    });
    expect(del.statusCode).toBe(404);
    const after = await prisma.workflow.findUniqueOrThrow({ where: { id: ids.workflowB } });
    expect(after.name).toBe('org B workflow');
    expect(after.deletedAt).toBeNull();
    expect(await prisma.workflowRun.count({ where: { workflowId: ids.workflowB } })).toBe(0);
  });

  t('PATCH and DELETE /email-templates/:id', async () => {
    const patch = await server.inject({
      method: 'PATCH',
      url: `/api/v1/email-templates/${ids.templateB}`,
      headers: admin,
      payload: { subject: 'hijacked' },
    });
    expect(patch.statusCode).toBe(404);
    const del = await server.inject({
      method: 'DELETE',
      url: `/api/v1/email-templates/${ids.templateB}`,
      headers: admin,
    });
    expect(del.statusCode).toBe(404);
    const after = await prisma.emailTemplate.findUniqueOrThrow({ where: { id: ids.templateB } });
    expect(after.subject).toBe('s');
    expect(after.deletedAt).toBeNull();
  });

  t('PATCH /pipeline-stages/:id', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/v1/pipeline-stages/${ids.stageB}`,
      headers: admin,
      payload: { name: 'hijacked' },
    });
    expect(res.statusCode).toBe(404);
    const after = await prisma.pipelineStage.findUniqueOrThrow({ where: { id: ids.stageB } });
    expect(after.name).toBe(ids.stageBName);
  });
});

// The Prisma client hides soft-deleted rows, so read them back with SQL.
async function rawTemplate(id: string) {
  const rows = await prisma.$queryRaw<Array<{ subject: string; deleted_at: Date | null }>>`
    SELECT subject, deleted_at FROM email_templates WHERE id = ${id}::uuid
  `;
  return rows[0]!;
}

// Positive controls: the same requests against org A's own rows succeed, so a
// renamed or removed route cannot make the 404 checks above pass.
describe('the same writes succeed inside the caller org', () => {
  t('PATCH /users/:id/role on a teammate', async () => {
    const mate = await prisma.user.findFirstOrThrow({
      where: { orgId: orgA! },
      orderBy: { createdAt: 'desc' },
    });
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/v1/users/${mate.id}/role`,
      headers: admin,
      payload: { role: 'member' },
    });
    expect(res.statusCode, res.body).toBe(200);
  });

  t('DELETE /integrations/api-keys/:id on an own key', async () => {
    const rawKey = `bs_own_${randomUUID()}`;
    const own = await prisma.apiKey.create({
      data: {
        orgId: orgA!,
        name: 'org A key',
        prefix: rawKey.slice(0, 8),
        hashedKey: createHash('sha256').update(rawKey).digest('hex'),
        scopes: ['read'],
      },
    });
    const res = await server.inject({ method: 'DELETE', url: `/api/v1/integrations/api-keys/${own.id}`, headers: admin });
    expect(res.statusCode, res.body).toBe(204);
  });

  t('PATCH /workflows/:id, /email-templates/:id and /pipeline-stages/:id on own rows', async () => {
    const wf = await prisma.workflow.create({ data: { orgId: orgA!, name: 'org A workflow', triggerKind: 'manual' } });
    const wfRes = await server.inject({
      method: 'PATCH',
      url: `/api/v1/workflows/${wf.id}`,
      headers: admin,
      payload: { name: 'renamed' },
    });
    expect(wfRes.statusCode, wfRes.body).toBe(200);

    const tpl = await prisma.emailTemplate.create({
      data: { orgId: orgA!, name: `org A template ${randomUUID()}`, subject: 's', bodyHtml: '<p>a</p>' },
    });
    const tplRes = await server.inject({
      method: 'PATCH',
      url: `/api/v1/email-templates/${tpl.id}`,
      headers: admin,
      payload: { subject: 'updated' },
    });
    expect(tplRes.statusCode, tplRes.body).toBe(200);

    const pipeline = await prisma.pipeline.create({ data: { orgId: orgA!, name: `org A pipeline ${randomUUID()}` } });
    const stage = await prisma.pipelineStage.create({
      data: { orgId: orgA!, pipelineId: pipeline.id, key: 'qualify', name: 'Qualify' },
    });
    const stageRes = await server.inject({
      method: 'PATCH',
      url: `/api/v1/pipeline-stages/${stage.id}`,
      headers: admin,
      payload: { name: 'Qualified' },
    });
    expect(stageRes.statusCode, stageRes.body).toBe(200);
  });
});

describe('soft-deleted email templates stay deleted', () => {
  t('PATCH on a deleted template answers 404 and does not edit it', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/v1/email-templates/${ids.deletedTemplateA}`,
      headers: admin,
      payload: { subject: 'edited after delete' },
    });
    expect(res.statusCode).toBe(404);
    expect((await rawTemplate(ids.deletedTemplateA)).subject).toBe('s');
  });

  t('DELETE on a deleted template answers 404 and keeps the original deletedAt', async () => {
    const before = await rawTemplate(ids.deletedTemplateA);
    const res = await server.inject({
      method: 'DELETE',
      url: `/api/v1/email-templates/${ids.deletedTemplateA}`,
      headers: admin,
    });
    expect(res.statusCode).toBe(404);
    const after = await rawTemplate(ids.deletedTemplateA);
    expect(after.deleted_at?.toISOString()).toBe(before.deleted_at?.toISOString());
  });
});

describe('API key lastUsedAt', () => {
  async function keyUsedAgo(msAgo: number) {
    const rawKey = `bs_lastused_${randomUUID()}`;
    const key = await prisma.apiKey.create({
      data: {
        orgId: orgA!,
        name: 'last used probe',
        prefix: rawKey.slice(0, 8),
        hashedKey: createHash('sha256').update(rawKey).digest('hex'),
        scopes: ['read'],
        lastUsedAt: new Date(Date.now() - msAgo),
      },
    });
    return { rawKey, key };
  }

  async function settle() {
    await new Promise((r) => setTimeout(r, 300));
  }

  t('a key used seconds ago is not rewritten on every request', async () => {
    const { rawKey, key } = await keyUsedAgo(5_000);
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/opportunities?limit=1',
      headers: { 'x-api-key': rawKey },
    });
    expect(res.statusCode).toBe(200);
    await settle();
    const after = await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } });
    expect(after.lastUsedAt?.toISOString()).toBe(key.lastUsedAt?.toISOString());
  });

  t('a key idle for minutes gets a fresh lastUsedAt', async () => {
    const { rawKey, key } = await keyUsedAgo(10 * 60_000);
    await server.inject({
      method: 'GET',
      url: '/api/v1/opportunities?limit=1',
      headers: { 'x-api-key': rawKey },
    });
    await settle();
    const after = await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } });
    expect(after.lastUsedAt!.getTime()).toBeGreaterThan(key.lastUsedAt!.getTime());
  });
});

describe('query-string booleans', () => {
  t('GET /workflows?active=false lists only inactive workflows', async () => {
    await prisma.workflow.create({
      data: { orgId: orgA!, name: 'inactive wf', triggerKind: 'manual', active: false },
    });
    await prisma.workflow.create({
      data: { orgId: orgA!, name: 'active wf', triggerKind: 'manual', active: true },
    });
    const res = await server.inject({ method: 'GET', url: '/api/v1/workflows?active=false', headers: admin });
    expect(res.statusCode).toBe(200);
    const names = (res.json() as { items: Array<{ name: string; active: boolean }> }).items;
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((w) => w.active === false)).toBe(true);
  });
});

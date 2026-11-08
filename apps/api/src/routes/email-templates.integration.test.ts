/**
 * Email template routes: authoring, render preview, tenant isolation, RBAC,
 * list bounds and soft deletes. Rendering never sends anything.
 */
import { randomUUID } from 'node:crypto';

import { prisma } from '@bidstack/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../server.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../test-support/isolated-org.js';

let server: FastifyInstance;
let orgId = '';
let otherOrgId = '';
let restoreAuth: (() => void) | null = null;

const body = { name: 'Follow up', subject: 'Hello {{account.name}}', bodyHtml: '<p>Hi {{account.name}}</p>' };

beforeAll(async () => {
  const org = await createIsolatedOrg('emailtpl');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  otherOrgId = (await createIsolatedOrg('emailtpl_other')).orgId;
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  await server?.close();
  restoreAuth?.();
  if (orgId) await dropIsolatedOrg(orgId);
  if (otherOrgId) await dropIsolatedOrg(otherOrgId);
});

beforeEach(async () => {
  await prisma.emailTemplate.deleteMany({ where: { orgId: { in: [orgId, otherOrgId] } } });
});

async function create(payload = body) {
  const res = await server.inject({ method: 'POST', url: '/api/v1/email-templates', payload });
  expect(res.statusCode).toBe(201);
  return res.json<{ id: string }>().id;
}

describe('email template authoring', () => {
  it('creates and lists templates', async () => {
    await create();
    const res = await server.inject({ method: 'GET', url: '/api/v1/email-templates' });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ items: Array<{ name: string }>; pageContinues: boolean }>()).toMatchObject({
      items: [{ name: 'Follow up' }],
      pageContinues: false,
    });
  });

  it('rejects an empty template', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/email-templates',
      payload: { name: '', subject: '', bodyHtml: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('forbids authoring for a read-only role', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/email-templates',
      headers: { 'x-bidstack-e2e-role': 'viewer' },
      payload: body,
    });
    expect(res.statusCode).toBe(403);
  });

  it('hides another org template on patch, delete and render', async () => {
    const foreign = await prisma.emailTemplate.create({
      data: { orgId: otherOrgId, name: 'Foreign', subject: 's', bodyHtml: '<p>x</p>' },
    });
    const patch = await server.inject({
      method: 'PATCH',
      url: `/api/v1/email-templates/${foreign.id}`,
      payload: { name: 'Taken' },
    });
    expect(patch.statusCode).toBe(404);
    const del = await server.inject({ method: 'DELETE', url: `/api/v1/email-templates/${foreign.id}` });
    expect(del.statusCode).toBe(404);
    const render = await server.inject({
      method: 'POST',
      url: '/api/v1/email-templates/render',
      payload: { templateId: foreign.id, context: {} },
    });
    expect(render.statusCode).toBe(404);
    expect((await prisma.emailTemplate.findUnique({ where: { id: foreign.id } }))?.name).toBe('Foreign');
  });

  it('answers 404 to a second delete of the same template', async () => {
    const id = await create();
    const first = await server.inject({ method: 'DELETE', url: `/api/v1/email-templates/${id}` });
    expect(first.statusCode).toBe(204);
    const again = await server.inject({ method: 'DELETE', url: `/api/v1/email-templates/${id}` });
    expect(again.statusCode).toBe(404);
  });

  it('caps the list at one page and says more exist', async () => {
    await prisma.emailTemplate.createMany({
      data: Array.from({ length: 201 }, (_, i) => ({
        orgId,
        name: `T${String(i).padStart(3, '0')}`,
        subject: 's',
        bodyHtml: '<p>x</p>',
      })),
    });
    const res = await server.inject({ method: 'GET', url: '/api/v1/email-templates' });
    const json = res.json<{ items: unknown[]; pageContinues: boolean }>();
    expect(json.items).toHaveLength(200);
    expect(json.pageContinues).toBe(true);
  });
});

describe('email template render', () => {
  it('escapes CRM values placed into the HTML body', async () => {
    const company = await prisma.company.create({
      data: { orgId, name: '<img src=x onerror=alert(1)> & Co' },
    });
    const id = await create();
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/email-templates/render',
      payload: { templateId: id, context: { accountId: company.id } },
    });
    expect(res.statusCode).toBe(200);
    const out = res.json<{ subject: string; bodyHtml: string; bodyText: string }>();
    expect(out.bodyHtml).toBe('<p>Hi &lt;img src=x onerror=alert(1)&gt; &amp; Co</p>');
    expect(out.subject).toBe('Hello <img src=x onerror=alert(1)> & Co');
  });

  it('returns 404 for an unknown template', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/email-templates/render',
      payload: { templateId: randomUUID(), context: {} },
    });
    expect(res.statusCode).toBe(404);
  });
});

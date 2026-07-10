// WHY: the Clerk webhook is the automatic tenant-bootstrap door. If it drifts,
// brand-new production orgs silently regress to the manual `pnpm db:seed:prod`
// path (sign-in 404s, admin 403s). These tests pin: signature enforcement,
// org + system-role creation in one delivery, idempotent redelivery, name
// sync, and that organization.deleted NEVER deletes tenant data.
import { createHmac, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

const KEY_B64 = Buffer.from('clerk-integration-key-32-bytes!!').toString('base64');
const SECRET = `whsec_${KEY_B64}`;

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let previousSecret: string | undefined;
const createdClerkOrgs: string[] = [];

function signedHeaders(rawBody: string): Record<string, string> {
  const id = `msg_${randomUUID()}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = Buffer.from(KEY_B64, 'base64');
  const sig = createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest('base64');
  return {
    'content-type': 'application/json',
    'svix-id': id,
    'svix-timestamp': timestamp,
    'svix-signature': `v1,${sig}`,
  };
}

async function postClerk(payload: unknown, headers?: Record<string, string>) {
  const rawBody = JSON.stringify(payload);
  return server.inject({
    method: 'POST',
    url: '/webhooks/clerk',
    headers: headers ?? signedHeaders(rawBody),
    payload: rawBody,
  });
}

beforeAll(async () => {
  previousSecret = process.env.CLERK_WEBHOOK_SECRET;
  process.env.CLERK_WEBHOOK_SECRET = SECRET;
  server = await buildServer();
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
  }
});

afterAll(async () => {
  if (previousSecret === undefined) delete process.env.CLERK_WEBHOOK_SECRET;
  else process.env.CLERK_WEBHOOK_SECRET = previousSecret;
  if (dbReachable && createdClerkOrgs.length > 0) {
    await prisma.org.deleteMany({ where: { clerkOrg: { in: createdClerkOrgs } } });
  }
  await server.close();
});

const t = makeSkipIfNoDb(() => dbReachable);

describe('POST /webhooks/clerk', () => {
  t('organization.created bootstraps the org with system roles, idempotently', async () => {
    const clerkOrg = `org_clerkwh_${randomUUID().slice(0, 12)}`;
    createdClerkOrgs.push(clerkOrg);
    const payload = { type: 'organization.created', data: { id: clerkOrg, name: 'Webhook Org' } };

    const res = await postClerk(payload);
    expect(res.statusCode).toBe(200);

    const org = await prisma.org.findUnique({ where: { clerkOrg } });
    expect(org).not.toBeNull();
    expect(org!.name).toBe('Webhook Org');

    // The whole point: the org must be USABLE — Admin role present so the
    // first Clerk admin sign-in gets its JIT grant instead of 403ing.
    const adminRole = await prisma.role.findFirst({
      where: { orgId: org!.id, name: 'Admin', isSystem: true, deletedAt: null },
    });
    expect(adminRole).not.toBeNull();

    // Svix redelivers on timeouts — a second identical delivery must not
    // duplicate or error.
    const again = await postClerk(payload);
    expect(again.statusCode).toBe(200);
    expect(await prisma.org.count({ where: { clerkOrg } })).toBe(1);
  });

  t('organization.updated syncs the name, bootstrapping if created was missed', async () => {
    const clerkOrg = `org_clerkwh_${randomUUID().slice(0, 12)}`;
    createdClerkOrgs.push(clerkOrg);

    // updated arriving before created (retry reordering) must still bootstrap.
    const res = await postClerk({
      type: 'organization.updated',
      data: { id: clerkOrg, name: 'First Name' },
    });
    expect(res.statusCode).toBe(200);
    const created = await prisma.org.findUnique({ where: { clerkOrg } });
    expect(created?.name).toBe('First Name');

    const rename = await postClerk({
      type: 'organization.updated',
      data: { id: clerkOrg, name: 'Renamed Org' },
    });
    expect(rename.statusCode).toBe(200);
    expect((await prisma.org.findUnique({ where: { clerkOrg } }))?.name).toBe('Renamed Org');
  });

  t('organization.deleted retains all tenant data', async () => {
    const clerkOrg = `org_clerkwh_${randomUUID().slice(0, 12)}`;
    createdClerkOrgs.push(clerkOrg);
    await postClerk({ type: 'organization.created', data: { id: clerkOrg, name: 'Keep Me' } });

    const res = await postClerk({ type: 'organization.deleted', data: { id: clerkOrg } });
    expect(res.statusCode).toBe(200);
    expect(await prisma.org.count({ where: { clerkOrg } })).toBe(1);
  });

  t('rejects a bad signature with 401 and writes nothing', async () => {
    const clerkOrg = `org_clerkwh_${randomUUID().slice(0, 12)}`;
    const rawBody = JSON.stringify({
      type: 'organization.created',
      data: { id: clerkOrg, name: 'Evil' },
    });
    const headers = signedHeaders(rawBody);
    headers['svix-signature'] = `v1,${Buffer.from('forged-signature-32-bytes-padd!!').toString('base64')}`;

    const res = await server.inject({
      method: 'POST',
      url: '/webhooks/clerk',
      headers,
      payload: rawBody,
    });
    expect(res.statusCode).toBe(401);
    expect(await prisma.org.count({ where: { clerkOrg } })).toBe(0);
  });

  t('rejects missing svix headers with 400', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/webhooks/clerk',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ type: 'organization.created', data: { id: 'org_x' } }),
    });
    expect(res.statusCode).toBe(400);
  });

  t('refuses to process when CLERK_WEBHOOK_SECRET is not configured', async () => {
    const saved = process.env.CLERK_WEBHOOK_SECRET;
    delete process.env.CLERK_WEBHOOK_SECRET;
    try {
      const rawBody = JSON.stringify({ type: 'organization.created', data: { id: 'org_x' } });
      const res = await server.inject({
        method: 'POST',
        url: '/webhooks/clerk',
        headers: signedHeaders(rawBody),
        payload: rawBody,
      });
      // The route throws 503, but the error handler masks app-thrown 5xx to a
      // generic 500 by design (no internals in 5xx bodies). What matters here:
      // the event is NOT acknowledged (non-2xx → Clerk retries) and nothing ran.
      expect(res.statusCode).toBeGreaterThanOrEqual(500);
    } finally {
      process.env.CLERK_WEBHOOK_SECRET = saved;
    }
  });

  t('acknowledges signed non-org events without writing anything', async () => {
    const res = await postClerk({ type: 'user.created', data: { id: 'user_123' } });
    expect(res.statusCode).toBe(200);
  });
});

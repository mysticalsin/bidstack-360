import { createHash } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  type IsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let isolatedOrg: IsolatedOrg | null = null;
let restoreAuth: (() => void) | undefined;
let previousStubRoleHeader: string | undefined;

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
  isolatedOrg = await createIsolatedOrg('orgsettings');
  restoreAuth = useIsolatedOrgAuth(isolatedOrg.clerkOrg);
  server = await buildServer();
  await server.ready();
}, 30_000);

afterAll(async () => {
  if (server) await server.close();
  restoreAuth?.();
  if (isolatedOrg) await dropIsolatedOrg(isolatedOrg.orgId);
  if (dbReachable) await prisma.$disconnect();
  if (previousStubRoleHeader === undefined) {
    delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  } else {
    process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previousStubRoleHeader;
  }
}, 30_000);

const skipIfNoDb = (name: string, fn: () => Promise<void> | void) =>
  it(name, async () => {
    if (!dbReachable || !isolatedOrg) {
      throw new Error(`[skip] ${name} - DATABASE_URL not reachable`);
    }
    await fn();
  });

describe('org locale settings', () => {
  skipIfNoDb('GET defaults then PUT persists audited workspace locale settings', async () => {
    const get = await server.inject({ method: 'GET', url: '/api/org-settings/locale' });
    expect(get.statusCode).toBe(200);
    expect(get.json()).toEqual({
      currency: 'CAD',
      dateFormat: 'YYYY-MM-DD',
      timezone: 'America/Toronto',
    });

    const put = await server.inject({
      method: 'PUT',
      url: '/api/org-settings/locale',
      payload: {
        currency: 'USD',
        dateFormat: 'MM/DD/YYYY',
        timezone: 'America/New_York',
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({
      currency: 'USD',
      dateFormat: 'MM/DD/YYYY',
      timezone: 'America/New_York',
    });

    const row = await prisma.orgSettings.findUnique({
      where: { orgId: isolatedOrg!.orgId },
      select: { defaultCurrency: true, dateFormat: true, timezone: true },
    });
    expect(row).toEqual({
      defaultCurrency: 'USD',
      dateFormat: 'MM/DD/YYYY',
      timezone: 'America/New_York',
    });

    const audit = await prisma.auditLog.findFirst({
      where: {
        orgId: isolatedOrg!.orgId,
        action: 'org_settings.locale.update',
      },
      orderBy: { at: 'desc' },
    });
    expect(audit?.diff).toMatchObject({ currency: 'USD', timezone: 'America/New_York' });
  });

  skipIfNoDb('PUT rejects unsupported locale values', async () => {
    const res = await server.inject({
      method: 'PUT',
      url: '/api/org-settings/locale',
      payload: { timezone: 'Mars/Olympus' },
    });
    expect(res.statusCode).toBe(400);
  });

  skipIfNoDb('PUT requires admin-grade settings access', async () => {
    const res = await server.inject({
      method: 'PUT',
      url: '/api/org-settings/locale',
      headers: { 'x-bidstack-e2e-role': 'manager' },
      payload: { currency: 'EUR' },
    });
    expect(res.statusCode).toBe(403);
  });

  skipIfNoDb('PUT rejects API keys even with settings write scope', async () => {
    const rawKey = `itest_locale_${Date.now()}`;
    const apiKey = await prisma.apiKey.create({
      data: {
        orgId: isolatedOrg!.orgId,
        name: 'integration-test locale key',
        hashedKey: createHash('sha256').update(rawKey).digest('hex'),
        prefix: rawKey.slice(0, 8),
        scopes: ['settings:read', 'settings:write'],
      },
    });
    try {
      const res = await server.inject({
        method: 'PUT',
        url: '/api/org-settings/locale',
        headers: { 'x-api-key': rawKey },
        payload: { currency: 'GBP' },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await prisma.apiKey.delete({ where: { id: apiKey.id } });
    }
  });
});

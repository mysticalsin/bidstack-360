import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;

const previousDustEnv = {
  apiKey: process.env.DUST_API_KEY,
  workspaceId: process.env.DUST_WORKSPACE_ID,
  baseUrl: process.env.DUST_BASE_URL,
};

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }

  const org = await prisma.org.findUnique({ where: { clerkOrg: 'org_seed_mantu' } });
  orgId = org?.id ?? null;
  if (!orgId) return;

  delete process.env.DUST_API_KEY;
  delete process.env.DUST_WORKSPACE_ID;
  delete process.env.DUST_BASE_URL;

  await prisma.syncEvent.deleteMany({
    where: { orgId, source: 'manual', eventType: 'dust.resync.requested' },
  });

  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (orgId) {
    await prisma.syncEvent.deleteMany({
      where: { orgId, source: 'manual', eventType: 'dust.resync.requested' },
    });
  }

  restoreDustEnv();
  if (server) await server.close();
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = (name: string, fn: () => Promise<void> | void) =>
  it(name, async () => {
    if (!dbReachable || !orgId) {
      console.warn(`[skip] ${name} - DATABASE_URL or seed org not reachable`);
      return;
    }
    await fn();
  });

describe('dust integration routes', () => {
  skipIfNoDb('GET /api/integrations/dust/status is honest in local stub mode', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/integrations/dust/status' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      workspace: 'mantu-presales',
      configured: false,
      agentsError: null,
      agents: [],
    });
  });

  skipIfNoDb('POST /api/integrations/dust/resync records the enqueue attempt', async () => {
    const res = await server.inject({ method: 'POST', url: '/api/integrations/dust/resync' });

    expect(res.statusCode).toBe(202);
    expect(res.json().jobId).toEqual(expect.any(String));

    const event = await prisma.syncEvent.findFirst({
      where: { orgId: orgId!, source: 'manual', eventType: 'dust.resync.requested' },
      orderBy: { receivedAt: 'desc' },
    });
    expect(event?.payload).toMatchObject({ jobId: res.json().jobId });
  });
});

function restoreDustEnv() {
  setOrDeleteEnv('DUST_API_KEY', previousDustEnv.apiKey);
  setOrDeleteEnv('DUST_WORKSPACE_ID', previousDustEnv.workspaceId);
  setOrDeleteEnv('DUST_BASE_URL', previousDustEnv.baseUrl);
}

function setOrDeleteEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

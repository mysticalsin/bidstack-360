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
  await prisma.auditLog.deleteMany({
    where: { orgId, action: 'integration.probe' },
  });

  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (orgId) {
    await prisma.syncEvent.deleteMany({
      where: { orgId, source: 'manual', eventType: 'dust.resync.requested' },
    });
    await prisma.auditLog.deleteMany({
      where: { orgId, action: 'integration.probe' },
    });
  }

  restoreDustEnv();
  if (server) await server.close();
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = (name: string, fn: () => Promise<void> | void) =>
  it(name, async () => {
    if (!dbReachable || !orgId) {
      throw new Error(`[skip] ${name} - DATABASE_URL or seed org not reachable`);
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

  skipIfNoDb('GET /api/integrations/setup-guide returns copy-safe setup contract', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/integrations/setup-guide' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mcp.publicUrl).toMatch(/\/mcp$/);
    expect(body.rest.authHeader).toBe('Authorization: Bearer <BIDSTACK_API_KEY>');
    expect(body.webhooks.receiverUrl).toMatch(/\/api\/webhooks\/dust$/);
    expect(body.mcp.readScopes).toEqual(['mcp', 'read']);
    expect(body.mcp.writeScopes).toEqual(['mcp', 'write']);
    expect(JSON.stringify(body)).not.toContain('DUST_API_KEY');
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

  skipIfNoDb('POST /api/integrations/probe rejects private network targets', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/integrations/probe',
      payload: { kind: 'mcp', url: 'https://10.0.0.1/mcp' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      message: 'Probe URL cannot target localhost, private networks, or internal hostnames.',
    });
    await expect(
      prisma.auditLog.count({ where: { orgId: orgId!, action: 'integration.probe' } }),
    ).resolves.toBe(0);
  });

  skipIfNoDb('POST /api/integrations/probe returns a safe structured result', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/integrations/probe',
      payload: { kind: 'mcp', url: 'http://localhost:9/mcp?token=secret#frag' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      ok: false,
      status: null,
      checkedUrl: 'http://localhost:9/mcp',
      message: expect.any(String),
      warnings: [],
    });
    expect(JSON.stringify(body)).not.toContain('secret');

    const event = await prisma.auditLog.findFirst({
      where: { orgId: orgId!, action: 'integration.probe' },
      orderBy: { at: 'desc' },
    });
    expect(event?.diff).toMatchObject({
      kind: 'mcp',
      checkedUrl: 'http://localhost:9/mcp',
      ok: false,
      status: null,
    });
    expect(JSON.stringify(event?.diff)).not.toContain('secret');
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

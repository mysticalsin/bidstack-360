// Integration tests for the model-provider routes: per-org credential storage,
// the ACTIVE-provider selector (vendor switch), and the live test-call.
// Pattern: contract-agreements.integration.test.ts — buildServer + inject against
// the seed org; agent-provider rows are fully isolated (cleaned before + after).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;

const BASE = '/api/v1/integrations/agent-providers';

async function cleanupAgentProviderRows(id: string): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM integration_configs
    WHERE org_id = ${id}::uuid AND name LIKE 'agent-provider:%'
  `;
  await prisma.auditLog.deleteMany({
    where: { orgId: id, action: { startsWith: 'agent_provider.' } },
  });
}

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
  await cleanupAgentProviderRows(orgId); // start from a known-empty state
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (orgId) await cleanupAgentProviderRows(orgId);
  if (server) await server.close();
  if (dbReachable) await prisma.$disconnect();
});

const t = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbReachable || !orgId) throw new Error(`[skip] ${name} — DB/seed org unavailable`);
    await fn();
  });

describe('agent provider routes', () => {
  t('lists all five providers with no active provider by default', async () => {
    const res = await server.inject({ method: 'GET', url: `${BASE}/credentials` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      items: Array<{ provider: string; configured: boolean }>;
      active: string | null;
    };
    expect(body.items.map((i) => i.provider).sort()).toEqual([
      'claude',
      'gemma',
      'kimi',
      'nvidia_nim',
      'openai',
    ]);
    expect(body.active).toBeNull();
    expect(body.items.find((i) => i.provider === 'gemma')?.configured).toBe(false);
  });

  t('refuses to activate a provider that has no stored credentials', async () => {
    const res = await server.inject({
      method: 'PUT',
      url: `${BASE}/active`,
      payload: { provider: 'openai' },
    });
    expect(res.statusCode).toBe(400);
  });

  t('stores a keyless gemma credential, activates it, and reports it active', async () => {
    const save = await server.inject({
      method: 'PUT',
      url: `${BASE}/credentials/gemma`,
      payload: { model: 'gemma3' },
    });
    expect(save.statusCode).toBe(200);
    expect((save.json() as { configured: boolean }).configured).toBe(true);

    const activate = await server.inject({
      method: 'PUT',
      url: `${BASE}/active`,
      payload: { provider: 'gemma' },
    });
    expect(activate.statusCode).toBe(200);
    expect((activate.json() as { active: string | null }).active).toBe('gemma');

    const list = await server.inject({ method: 'GET', url: `${BASE}/credentials` });
    expect((list.json() as { active: string | null }).active).toBe('gemma');

    // Activation is audited.
    const audit = await prisma.auditLog.findFirst({
      where: { orgId: orgId!, action: 'agent_provider.active.set' },
    });
    expect(audit).not.toBeNull();
  });

  t('test-call returns ok:false (no network) when the provider has no credentials', async () => {
    const res = await server.inject({ method: 'POST', url: `${BASE}/credentials/openai/test` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { provider: string; ok: boolean; latencyMs: number; error: string | null };
    expect(body.provider).toBe('openai');
    expect(body.ok).toBe(false);
    expect(body.latencyMs).toBe(0); // short-circuits before any provider call
    expect(body.error).toMatch(/credential/i);
  });

  t('clearing the active provider falls back to none', async () => {
    const res = await server.inject({
      method: 'PUT',
      url: `${BASE}/active`,
      payload: { provider: null },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { active: string | null }).active).toBeNull();
  });

  t('deleting the active credential also clears the active selector', async () => {
    // Re-activate gemma (cleared by the previous test).
    await server.inject({ method: 'PUT', url: `${BASE}/active`, payload: { provider: 'gemma' } });

    const del = await server.inject({ method: 'DELETE', url: `${BASE}/credentials/gemma` });
    expect(del.statusCode).toBe(204);

    const list = await server.inject({ method: 'GET', url: `${BASE}/credentials` });
    const body = list.json() as {
      items: Array<{ provider: string; configured: boolean }>;
      active: string | null;
    };
    expect(body.active).toBeNull(); // dangling selector dropped on credential delete
    expect(body.items.find((i) => i.provider === 'gemma')?.configured).toBe(false);
  });

  t('rejects an unknown provider id with a 400', async () => {
    const res = await server.inject({
      method: 'PUT',
      url: `${BASE}/active`,
      payload: { provider: 'bogus' },
    });
    expect(res.statusCode).toBe(400);
  });
});

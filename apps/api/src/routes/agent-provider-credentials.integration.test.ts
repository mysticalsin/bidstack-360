// Integration tests for the model-provider routes: per-org credential storage,
// the ACTIVE-provider selector (vendor switch), and the live test-call.
// Pattern: isolated org + buildServer inject; agent-provider rows are isolated
// by tenant and cleaned before/after for deterministic reruns.
import { createHash, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';
import { DIRECT_AGENT_PROVIDERS } from '@bidstack/shared/llm';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let restoreAuth: (() => void) | null = null;
let previousStubRoleHeader: string | undefined;

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
  previousStubRoleHeader = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const org = await createIsolatedOrg('agent-provider-credentials');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  await cleanupAgentProviderRows(orgId); // start from a known-empty state
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (orgId) await cleanupAgentProviderRows(orgId);
  if (server) await server.close();
  if (restoreAuth) restoreAuth();
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
  if (previousStubRoleHeader === undefined) {
    delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  } else {
    process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previousStubRoleHeader;
  }
});

const t = makeSkipIfNoDb(() => dbReachable && !!orgId);

describe('agent provider routes', () => {
  t('lists every registered provider with no active provider by default', async () => {
    const res = await server.inject({ method: 'GET', url: `${BASE}/credentials` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      items: Array<{ provider: string; configured: boolean }>;
      active: string | null;
    };
    // Asserted against the registry, not a hand-copied literal: the route builds
    // its items from DIRECT_AGENT_PROVIDERS, so a literal here only ever
    // re-states the source and goes stale the next time a provider is added.
    expect(body.items.map((i) => i.provider).sort()).toEqual([...DIRECT_AGENT_PROVIDERS].sort());
    expect(body.items).toHaveLength(DIRECT_AGENT_PROVIDERS.length);
    expect(body.items.map((i) => i.provider)).toContain('cloudflare');
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

  t('rejects API-key actors at admin-only provider writes with 403', async () => {
    const rawKey = `bs_test_agent_${randomUUID()}`;
    const apiKey = await prisma.apiKey.create({
      data: {
        orgId: orgId!,
        name: 'Agent provider route regression key',
        prefix: rawKey.slice(0, 8),
        hashedKey: createHash('sha256').update(rawKey).digest('hex'),
        scopes: ['read', 'write'],
      },
    });

    try {
      const res = await server.inject({
        method: 'PUT',
        url: `${BASE}/credentials/gemma`,
        headers: { 'x-api-key': rawKey },
        payload: { model: 'gemma3' },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ message: 'Requires one of: admin' });
    } finally {
      await prisma.apiKey.delete({ where: { id: apiKey.id } });
    }
  });

  t('403s a role without integrations:write at provider credential writes', async () => {
    const res = await server.inject({
      method: 'PUT',
      url: `${BASE}/credentials/gemma`,
      headers: { 'x-bidstack-e2e-role': 'read-only' },
      payload: { model: 'gemma3' },
    });
    expect(res.statusCode).toBe(403);
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

  // Regression for the omniroute rollout: it must get the SAME keyless
  // carve-out as gemma everywhere (save/activate/resolve), not just get
  // listed. Before isKeylessProvider(), only 'gemma' bypassed the apiKey
  // gate and this save would 400.
  t('stores a keyless omniroute credential, activates it, and resolves it without an apiKey', async () => {
    const save = await server.inject({
      method: 'PUT',
      url: `${BASE}/credentials/omniroute`,
      payload: {},
    });
    expect(save.statusCode).toBe(200);
    expect((save.json() as { configured: boolean }).configured).toBe(true);

    const activate = await server.inject({
      method: 'PUT',
      url: `${BASE}/active`,
      payload: { provider: 'omniroute' },
    });
    expect(activate.statusCode).toBe(200);
    expect((activate.json() as { active: string | null }).active).toBe('omniroute');

    const list = await server.inject({ method: 'GET', url: `${BASE}/credentials` });
    expect((list.json() as { active: string | null }).active).toBe('omniroute');

    // The test-call route only short-circuits with "No usable credentials"
    // when credentialToResolvedLlm() returns null. Getting past that (even
    // though the network call itself fails in CI, where no local OmniRoute
    // gateway is running) proves the keyless credential DID resolve to a
    // runnable ResolvedLlm.
    const probe = await server.inject({
      method: 'POST',
      url: `${BASE}/credentials/omniroute/test`,
    });
    expect(probe.statusCode).toBe(200);
    const probeBody = probe.json() as { ok: boolean; model: string | null; error: string | null };
    expect(probeBody.model).not.toBeNull();
    // Null when the local gateway actually answered (dev box), a different
    // message when it refused/timed out — either way NOT the short-circuit
    // "no usable credentials" text, which only fires when resolution failed.
    expect(probeBody.error ?? '').not.toMatch(/no usable credentials/i);

    // Clean up so later assertions (active === null etc.) aren't polluted.
    await server.inject({ method: 'PUT', url: `${BASE}/active`, payload: { provider: null } });
    await server.inject({ method: 'DELETE', url: `${BASE}/credentials/omniroute` });
  });

  t('test-call returns ok:false (no network) when the provider has no credentials', async () => {
    const res = await server.inject({ method: 'POST', url: `${BASE}/credentials/openai/test` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      provider: string;
      ok: boolean;
      latencyMs: number;
      error: string | null;
    };
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

import { createHash, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId = '';
let restoreAuth: (() => void) | null = null;
const apiKeyIds: string[] = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }

  const org = await createIsolatedOrg('ai-compute-auth');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  server = await buildServer();
  await server.ready();
}, 30_000);

afterAll(async () => {
  if (server) await server.close();
  if (!dbReachable) return;

  try {
    if (apiKeyIds.length > 0) {
      await prisma.apiKey.deleteMany({ where: { orgId, id: { in: apiKeyIds } } });
    }
  } finally {
    restoreAuth?.();
    if (orgId) await dropIsolatedOrg(orgId);
    await prisma.$disconnect();
  }
}, 30_000);

const t = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbReachable || !orgId) {
      throw new Error(`[skip] ${name}: DB/isolated org unavailable`);
    }
    await fn();
  });

async function createApiKey(scopes: string[]): Promise<string> {
  const raw = `ai-compute-${randomUUID()}`;
  const apiKey = await prisma.apiKey.create({
    data: {
      orgId,
      name: `ai compute auth ${scopes.join(',')}`,
      hashedKey: createHash('sha256').update(raw).digest('hex'),
      prefix: raw.slice(0, 8),
      scopes,
    },
  });
  apiKeyIds.push(apiKey.id);
  return raw;
}

describe('AI compute route authorization', () => {
  t('requires activities read scope for call transcript and recording detail', async () => {
    const rawKey = await createApiKey(['contacts:read']);

    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/calls/${randomUUID()}`,
      headers: { 'x-api-key': rawKey },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json<{ message: string }>().message).toContain('activities:read');
  });

  t('rejects API keys from AI assistant compute even with exact REST read scope', async () => {
    const rawKey = await createApiKey(['contacts:read']);

    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/ai-assistant/email-draft',
      headers: { 'x-api-key': rawKey },
      payload: {
        tone: 'friendly',
        intent: 'Follow up after the procurement workshop',
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json<{ message: string }>().message).toContain('user session');
  });

  t('rejects API keys from call insight extraction even with exact write scope', async () => {
    const rawKey = await createApiKey(['activities:write']);

    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/calls/${randomUUID()}/extract-insights`,
      headers: { 'x-api-key': rawKey },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json<{ message: string }>().message).toContain('user session');
  });

  t('rejects API keys from crew run even with exact agents:write scope', async () => {
    const rawKey = await createApiKey(['agents:write']);

    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/crews/${randomUUID()}/run`,
      headers: { 'x-api-key': rawKey },
      payload: { inputs: {}, approvalConfirmed: false },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json<{ message: string }>().message).toContain('user session');
  });

  t('rejects API keys from crew run retry even with exact agents:write scope', async () => {
    const rawKey = await createApiKey(['agents:write']);

    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/crew-runs/${randomUUID()}/retry`,
      headers: { 'x-api-key': rawKey },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json<{ message: string }>().message).toContain('user session');
  });

  t('requires agents:write scope to cancel a crew run (read scope is denied)', async () => {
    const rawKey = await createApiKey(['contacts:read']);

    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/crew-runs/${randomUUID()}/cancel`,
      headers: { 'x-api-key': rawKey },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json<{ message: string }>().message).toContain('agents:write');
  });
});

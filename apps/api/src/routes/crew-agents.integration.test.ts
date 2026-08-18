// Integration tests for /api/v1/crew-agents/* — RBAC coverage for ISSUES #27.
//
// POST / PATCH / DELETE now require the `agents:write` permission (previously
// a coarser `requireRole('admin')` gate). These tests exercise both directions
// through the real route + real DB: 403 for an authenticated caller who lacks
// the permission, 2xx for one who holds it. Mirrors the pattern already used
// by crews.integration.test.ts's "crew authoring RBAC" suite.

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

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
let userId: string | null = null;
let restoreAuth: (() => void) | undefined;
let previousStubRoleHeader: string | undefined;

const ADMIN_HEADERS = { 'x-bidstack-e2e-role': 'admin' };
// Sales Manager holds every :read permission (including agents:read) but no
// agents:write per packages/db/src/seed.rbac.ts — the right "authenticated but
// unpermitted" fixture for the 403 side of the agents:write gate below.
const NO_AGENTS_WRITE_HEADERS = { 'x-bidstack-e2e-role': 'manager' };

const createdAgentKeys: string[] = [];

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

  const org = await createIsolatedOrg('crew-agents');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  const user = orgId
    ? await prisma.user.findFirst({ where: { orgId }, orderBy: { createdAt: 'asc' } })
    : null;
  userId = user?.id ?? null;
  if (!orgId || !userId) return;

  server = await buildServer();
  await server.ready();
}, 30_000);

afterAll(async () => {
  if (server) await server.close();
  if (dbReachable) {
    if (createdAgentKeys.length > 0 && orgId) {
      await prisma.crewAgent.deleteMany({ where: { orgId, agentKey: { in: createdAgentKeys } } });
    }
    restoreAuth?.();
    if (orgId) await dropIsolatedOrg(orgId);
    await prisma.$disconnect();
  }
  if (previousStubRoleHeader === undefined) {
    delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  } else {
    process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previousStubRoleHeader;
  }
}, 60_000);

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!orgId && !!userId);

async function createAgent(agentKey = `agent-${randomUUID()}`) {
  createdAgentKeys.push(agentKey);
  const agent = await prisma.crewAgent.create({
    data: {
      orgId: orgId!,
      agentKey,
      role: 'RBAC Test Agent',
      goal: 'Prove the agents:write gate on crew-agents routes',
      backstory: 'Created by crew-agents route regression tests.',
      tools: [],
      createdByUserId: userId!,
    },
  });
  return agent.id;
}

describe('crew-agent authoring RBAC (agents:write)', () => {
  skipIfNoDb('POST /crew-agents rejects a caller without agents:write', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/crew-agents',
      headers: NO_AGENTS_WRITE_HEADERS,
      payload: {
        agentKey: `denied-${randomUUID()}`,
        role: 'Denied Agent',
        goal: 'Should never be created',
        backstory: 'Rejected by the permission gate.',
        tools: [],
      },
    });
    expect(res.statusCode).toBe(403);
  });

  skipIfNoDb('POST /crew-agents admits a caller with agents:write (Admin)', async () => {
    const agentKey = `admitted-${randomUUID()}`;
    createdAgentKeys.push(agentKey);
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/crew-agents',
      headers: ADMIN_HEADERS,
      payload: {
        agentKey,
        role: 'Admitted Agent',
        goal: 'Created by an admin holding agents:write',
        backstory: 'Admitted by the permission gate.',
        tools: [],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ agentKey: string }>().agentKey).toBe(agentKey);
  });

  skipIfNoDb('PATCH /crew-agents/:id rejects a caller without agents:write', async () => {
    const id = await createAgent();
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/v1/crew-agents/${id}`,
      headers: NO_AGENTS_WRITE_HEADERS,
      payload: {
        role: 'Renamed without permission',
        goal: 'Should not apply',
        backstory: 'Rejected by the permission gate.',
        tools: [],
      },
    });
    expect(res.statusCode).toBe(403);
  });

  skipIfNoDb('PATCH /crew-agents/:id admits a caller with agents:write (Admin)', async () => {
    const id = await createAgent();
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/v1/crew-agents/${id}`,
      headers: ADMIN_HEADERS,
      payload: {
        role: 'Renamed by admin',
        goal: 'Updated by an admin holding agents:write',
        backstory: 'Admitted by the permission gate.',
        tools: [],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ role: string }>().role).toBe('Renamed by admin');
  });

  skipIfNoDb('DELETE /crew-agents/:id rejects a caller without agents:write', async () => {
    const id = await createAgent();
    const res = await server.inject({
      method: 'DELETE',
      url: `/api/v1/crew-agents/${id}`,
      headers: NO_AGENTS_WRITE_HEADERS,
    });
    expect(res.statusCode).toBe(403);
  });

  skipIfNoDb('DELETE /crew-agents/:id admits a caller with agents:write (Admin)', async () => {
    const id = await createAgent();
    const res = await server.inject({
      method: 'DELETE',
      url: `/api/v1/crew-agents/${id}`,
      headers: ADMIN_HEADERS,
    });
    expect(res.statusCode).toBe(204);
  });
});

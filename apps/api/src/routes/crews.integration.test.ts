import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';

const {
  enqueueCrewRunMock,
  cancelQueuedCrewRunMock,
  checkSerumAgentRuntimePolicyMock,
  checkSerumLoopRuntimePolicyMock,
} = vi.hoisted(() => ({
  enqueueCrewRunMock: vi.fn(
    async (job: { runId: string }): Promise<string | null> => `crew-run-${job.runId}`,
  ),
  cancelQueuedCrewRunMock: vi.fn(async (): Promise<boolean> => true),
  checkSerumAgentRuntimePolicyMock: vi.fn(),
  checkSerumLoopRuntimePolicyMock: vi.fn(),
}));

vi.mock('../queues/crew-run.js', () => ({
  enqueueCrewRun: enqueueCrewRunMock,
  cancelQueuedCrewRun: cancelQueuedCrewRunMock,
}));

vi.mock('@bidstack/db/serum-runtime-policy', () => ({
  SERUM_RUNTIME_CONFIG_KEYS: { agents: 'registry', loops: 'orchestration' },
  checkSerumAgentRuntimePolicy: checkSerumAgentRuntimePolicyMock,
  checkSerumLoopRuntimePolicy: checkSerumLoopRuntimePolicyMock,
}));

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let userId: string | null = null;
let restoreAuth: (() => void) | undefined;

const createdCrewIds: string[] = [];
const createdRunIds: string[] = [];
const createdOrgIds: string[] = [];
const createdAgentKeys: string[] = [];

beforeEach(() => {
  checkSerumAgentRuntimePolicyMock.mockReset();
  checkSerumAgentRuntimePolicyMock.mockResolvedValue({
    allowed: true,
    status: 'allowed',
    reason: 'allowed by test policy',
    activeConfigVersionId: randomUUID(),
  });
  checkSerumLoopRuntimePolicyMock.mockReset();
  checkSerumLoopRuntimePolicyMock.mockResolvedValue({
    allowed: true,
    status: 'allowed',
    reason: 'loop allowed by test policy',
    activeConfigVersionId: randomUUID(),
  });
});

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }

  const org = await createIsolatedOrg('crews');
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
    const targetIds = [...createdRunIds, ...createdCrewIds];
    if (targetIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { targetId: { in: targetIds } } });
    }
    if (createdRunIds.length > 0) {
      await prisma.$executeRaw`
        DELETE FROM crew_runs WHERE id = ANY(${createdRunIds}::uuid[])
      `;
    }
    if (createdCrewIds.length > 0) {
      await prisma.$executeRaw`
        DELETE FROM crew_tasks WHERE crew_id = ANY(${createdCrewIds}::uuid[])
      `;
      await prisma.$executeRaw`
        DELETE FROM crews WHERE id = ANY(${createdCrewIds}::uuid[])
      `;
    }
    if (createdAgentKeys.length > 0 && orgId) {
      await prisma.crewAgent.deleteMany({
        where: { orgId, agentKey: { in: createdAgentKeys } },
      });
    }
    if (createdOrgIds.length > 0) {
      await prisma.org.deleteMany({ where: { id: { in: createdOrgIds } } });
    }
    restoreAuth?.();
    if (orgId) await dropIsolatedOrg(orgId);
    await prisma.$disconnect();
  }
}, 60_000);

const skipIfNoDb = (name: string, fn: () => Promise<void> | void) =>
  it(name, async () => {
    if (!dbReachable || !orgId || !userId) {
      throw new Error(
        `[skip] ${name} - DATABASE_URL, isolated org, or isolated user not reachable`,
      );
    }
    await fn();
  });

async function createCrew(targetOrgId = orgId!, targetUserId: string | null = userId!) {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO crews
      (id, org_id, name, description, process, manager_agent_key, created_by_user_id, created_at, updated_at)
    VALUES
      (gen_random_uuid(), ${targetOrgId}::uuid, ${`Route Test Crew ${randomUUID()}`},
       'Created by crew route regression tests', 'sequential', null, ${targetUserId}::uuid, now(), now())
    RETURNING id
  `;
  const id = rows[0]?.id;
  if (!id) throw new Error('createCrew returned no id');
  createdCrewIds.push(id);
  return id;
}

async function createCrewWithAgent(agentKey = `agent-${randomUUID()}`) {
  createdAgentKeys.push(agentKey);
  await prisma.crewAgent.create({
    data: {
      orgId: orgId!,
      agentKey,
      role: 'Route Test Agent',
      goal: 'Prove SERUM runtime policy gates crew execution',
      backstory: 'Created by crew route regression tests.',
      tools: [],
      createdByUserId: userId!,
    },
  });
  const crewId = await createCrew();
  await prisma.crewTask.create({
    data: {
      orgId: orgId!,
      crewId,
      taskKey: `task-${randomUUID()}`,
      description: 'Review the supplied RFP.',
      expectedOutput: 'A short review.',
      agentKey,
      contextKeys: [],
      sortOrder: 0,
    },
  });
  return { crewId, agentKey };
}

async function createRun(
  crewId: string,
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'partial',
  inputs: Record<string, string> = { rfp: 'Route-level RFP text used for retry.' },
  targetOrgId = orgId!,
  targetUserId: string | null = userId!,
) {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO crew_runs
      (id, org_id, crew_id, started_by_user_id, status, inputs, error, created_at, completed_at)
    VALUES
      (gen_random_uuid(), ${targetOrgId}::uuid, ${crewId}::uuid, ${targetUserId}::uuid,
       ${status}, ${JSON.stringify(inputs)}::jsonb,
       ${status === 'failed' ? 'provider failed' : null}, now(),
       ${status === 'queued' || status === 'running' ? null : new Date()}::timestamptz)
    RETURNING id
  `;
  const id = rows[0]?.id;
  if (!id) throw new Error('createRun returned no id');
  createdRunIds.push(id);
  return id;
}

describe('crew run controls', () => {
  skipIfNoDb('blocks starting a crew run when SERUM denies the loop policy', async () => {
    enqueueCrewRunMock.mockClear();
    checkSerumLoopRuntimePolicyMock.mockResolvedValueOnce({
      allowed: false,
      status: 'disabled',
      reason: 'SERUM Loops policy is published but disabled.',
      activeConfigVersionId: randomUUID(),
    });
    const { crewId } = await createCrewWithAgent();

    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/crews/${crewId}/run`,
      payload: { inputs: { rfp: 'RFP text' }, approvalConfirmed: true },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json<{ message: string }>().message).toContain('SERUM runtime denied loop');
    expect(enqueueCrewRunMock).not.toHaveBeenCalled();
    expect(checkSerumAgentRuntimePolicyMock).not.toHaveBeenCalled();
    expect(checkSerumLoopRuntimePolicyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId,
        configKey: 'orchestration',
        loopId: crewId,
        operation: 'crew.run',
        hasDurableEvent: true,
        approvalGateReached: false,
      }),
    );
  });

  skipIfNoDb('blocks starting a crew run when SERUM denies a referenced agent', async () => {
    enqueueCrewRunMock.mockClear();
    checkSerumAgentRuntimePolicyMock.mockResolvedValueOnce({
      allowed: false,
      status: 'not_configured',
      reason: 'No active SERUM Agents policy is published.',
      activeConfigVersionId: null,
    });
    const { crewId, agentKey } = await createCrewWithAgent();

    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/crews/${crewId}/run`,
      payload: { inputs: { rfp: 'RFP text' }, approvalConfirmed: true },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json<{ message: string }>().message).toContain(
      `SERUM runtime denied agent "${agentKey}"`,
    );
    expect(enqueueCrewRunMock).not.toHaveBeenCalled();
    expect(checkSerumAgentRuntimePolicyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId,
        configKey: 'registry',
        agentId: agentKey,
        approvalConfirmed: true,
      }),
    );
  });

  skipIfNoDb('requires explicit approval before queueing a SERUM-governed crew run', async () => {
    enqueueCrewRunMock.mockClear();
    const { crewId, agentKey } = await createCrewWithAgent();
    checkSerumAgentRuntimePolicyMock.mockImplementation(
      async (args: { approvalConfirmed: boolean }) => ({
        allowed: args.approvalConfirmed,
        status: args.approvalConfirmed ? 'allowed' : 'denied',
        reason: args.approvalConfirmed
          ? 'Agent run is allowed by the active SERUM policy.'
          : 'Human approval confirmation is required before an agent run can start.',
        activeConfigVersionId: randomUUID(),
      }),
    );

    const blocked = await server.inject({
      method: 'POST',
      url: `/api/v1/crews/${crewId}/run`,
      payload: { inputs: { rfp: 'RFP text' } },
    });
    expect(blocked.statusCode).toBe(409);
    expect(enqueueCrewRunMock).not.toHaveBeenCalled();

    const allowed = await server.inject({
      method: 'POST',
      url: `/api/v1/crews/${crewId}/run`,
      payload: { inputs: { rfp: 'RFP text' }, approvalConfirmed: true },
    });
    expect(allowed.statusCode).toBe(202);
    const body = allowed.json<{ runId: string }>();
    createdRunIds.push(body.runId);
    expect(enqueueCrewRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        crewId,
        runId: body.runId,
        inputs: { rfp: 'RFP text' },
        approvalConfirmed: true,
      }),
    );
    expect(checkSerumAgentRuntimePolicyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ agentId: agentKey, approvalConfirmed: true }),
    );
  });

  skipIfNoDb('cancels a queued crew run and removes the queued job', async () => {
    const crewId = await createCrew();
    const runId = await createRun(crewId, 'queued');

    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/crew-runs/${runId}/cancel`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: runId,
      status: 'cancelled',
      error: 'Cancelled by user',
    });
    expect(cancelQueuedCrewRunMock).toHaveBeenCalledWith(runId);
  });

  skipIfNoDb('rejects cancelling terminal crew runs', async () => {
    const crewId = await createCrew();
    const runId = await createRun(crewId, 'completed');

    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/crew-runs/${runId}/cancel`,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json<{ message: string }>().message).toMatch(/cannot be cancelled from completed/);
  });

  skipIfNoDb('retries a failed crew run with the stored inputs', async () => {
    enqueueCrewRunMock.mockClear();
    const crewId = await createCrew();
    const originalInput = { rfp: 'Exact RFP body that must survive retry.' };
    const runId = await createRun(crewId, 'failed', originalInput);

    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/crew-runs/${runId}/retry`,
    });

    expect(res.statusCode).toBe(202);
    const body = res.json<{ runId: string; status: string }>();
    expect(body.status).toBe('queued');
    createdRunIds.push(body.runId);
    expect(enqueueCrewRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ crewId, runId: body.runId, inputs: originalInput }),
    );

    const rows = await prisma.$queryRaw<{ inputs: unknown; status: string }[]>`
      SELECT inputs, status FROM crew_runs
      WHERE id = ${body.runId}::uuid AND org_id = ${orgId}::uuid
      LIMIT 1
    `;
    expect(rows[0]).toMatchObject({ status: 'queued', inputs: originalInput });
  });

  skipIfNoDb('returns 404 for a cross-org crew run', async () => {
    const foreignOrg = await prisma.org.create({
      data: { clerkOrg: `org_crew_run_foreign_${randomUUID()}`, name: 'Foreign Crew Org' },
    });
    createdOrgIds.push(foreignOrg.id);
    const crewId = await createCrew(foreignOrg.id, null);
    const runId = await createRun(crewId, 'queued', undefined, foreignOrg.id, null);

    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/crew-runs/${runId}/cancel`,
    });

    expect(res.statusCode).toBe(404);
  });
});

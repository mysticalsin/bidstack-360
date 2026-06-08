import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';

const { enqueueCrewRunMock, cancelQueuedCrewRunMock } = vi.hoisted(() => ({
  enqueueCrewRunMock: vi.fn(
    async (job: { runId: string }): Promise<string | null> => `crew-run-${job.runId}`,
  ),
  cancelQueuedCrewRunMock: vi.fn(async (): Promise<boolean> => true),
}));

vi.mock('../queues/crew-run.js', () => ({
  enqueueCrewRun: enqueueCrewRunMock,
  cancelQueuedCrewRun: cancelQueuedCrewRunMock,
}));

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let userId: string | null = null;

const createdCrewIds: string[] = [];
const createdRunIds: string[] = [];
const createdOrgIds: string[] = [];

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
    if (createdOrgIds.length > 0) {
      await prisma.org.deleteMany({ where: { id: { in: createdOrgIds } } });
    }
    await prisma.$disconnect();
  }
}, 60_000);

const skipIfNoDb = (name: string, fn: () => Promise<void> | void) =>
  it(name, async () => {
    if (!dbReachable || !orgId || !userId) {
      throw new Error(`[skip] ${name} - DATABASE_URL, seed org, or seed user not reachable`);
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

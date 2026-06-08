import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;

const createdAgentIds: string[] = [];
const createdRunIds: string[] = [];

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

  server = await buildServer();
  await server.ready();
}, 30_000);

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  if (server) await server.close();
  if (dbReachable) {
    const targetIds = [...createdAgentIds, ...createdRunIds];
    if (targetIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { targetId: { in: targetIds } } });
    }
    if (createdRunIds.length > 0) {
      await prisma.agentRun.deleteMany({ where: { id: { in: createdRunIds } } });
    }
    if (createdAgentIds.length > 0) {
      await prisma.agent.deleteMany({ where: { id: { in: createdAgentIds } } });
    }
    await prisma.$disconnect();
  }
}, 60_000);

const skipIfNoDb = (name: string, fn: () => Promise<void> | void) =>
  it(name, async () => {
    if (!dbReachable || !orgId) {
      throw new Error(`[skip] ${name} - DATABASE_URL or seed org not reachable`);
    }
    await fn();
  });

async function createAgent(status: 'idle' | 'running' | 'error' = 'idle') {
  if (!orgId) throw new Error('seed org missing');
  const agent = await prisma.agent.create({
    data: {
      orgId,
      name: `Run Control Agent ${crypto.randomUUID()}`,
      description: 'Created by agent run route regression tests',
      systemPrompt: 'Return concise RFP operating guidance.',
      tools: [],
      status,
      config: { provider: 'gemma', model: 'gemma3' },
    },
  });
  createdAgentIds.push(agent.id);
  return agent;
}

async function createRun(
  agentId: string,
  status: 'running' | 'completed' | 'failed' | 'cancelled',
  input: Record<string, unknown> = { message: 'test prompt' },
) {
  if (!orgId) throw new Error('seed org missing');
  const now = new Date();
  const run = await prisma.agentRun.create({
    data: {
      orgId,
      agentId,
      status,
      input,
      startedAt: status === 'running' ? now : new Date(now.getTime() - 250),
      finishedAt: status === 'running' ? null : now,
      error: status === 'failed' ? 'provider failed' : null,
    },
  });
  createdRunIds.push(run.id);
  return run;
}

describe('agent run controls', () => {
  skipIfNoDb('rejects duplicate active runs for the same agent', async () => {
    const agent = await createAgent('running');
    await createRun(agent.id, 'running');

    const beforeCount = await prisma.agentRun.count({ where: { agentId: agent.id } });
    const res = await server.inject({
      method: 'POST',
      url: `/api/agents/${agent.id}/run`,
      payload: { input: { message: 'do not duplicate' } },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json<{ message: string }>().message).toMatch(/active running run/);
    await expect(prisma.agentRun.count({ where: { agentId: agent.id } })).resolves.toBe(
      beforeCount,
    );
  });

  skipIfNoDb('cancels a running run and clears the agent status', async () => {
    const agent = await createAgent('running');
    const run = await createRun(agent.id, 'running');

    const res = await server.inject({
      method: 'POST',
      url: `/api/agent-runs/${run.id}/cancel`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: run.id,
      status: 'cancelled',
      error: 'Cancelled by user',
    });
    await expect(prisma.agent.findUnique({ where: { id: agent.id } })).resolves.toMatchObject({
      status: 'idle',
    });
  });

  skipIfNoDb('rejects cancelling terminal runs', async () => {
    const agent = await createAgent();
    const run = await createRun(agent.id, 'completed');

    const res = await server.inject({
      method: 'POST',
      url: `/api/agent-runs/${run.id}/cancel`,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json<{ message: string }>().message).toMatch(/cannot be cancelled from completed/);
  });

  skipIfNoDb('retries a failed run with the original input', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Retry succeeded with cited RFP guidance.' } }],
          usage: { input_tokens: 10, output_tokens: 7 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const agent = await createAgent('error');
    const run = await createRun(agent.id, 'failed', { message: 'retry this exact RFP read' });

    const res = await server.inject({
      method: 'POST',
      url: `/api/agent-runs/${run.id}/retry`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      agentId: agent.id,
      status: 'completed',
      input: { message: 'retry this exact RFP read' },
    });
    expect(body.output.text).toBe('Retry succeeded with cited RFP guidance.');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

// crew-run worker — executes a stored crew via the crew kit's kickoff() and
// persists the CrewRun result. Loads the crew + agents + tasks via parameterized
// raw SQL (Wave 10 tables are not in the generated Prisma client yet — Windows
// DLL lock; mirrors the Wave 9 RFP pattern). Org-scoped throughout.

import type { Queue, Worker, Job } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { Worker as BullWorker, Queue as BullQueue } from 'bullmq';
import { z } from 'zod';
import { prisma } from '@bidstack/db';

import { CREW_RUN } from '@bidstack/shared';

import { kickoff } from '../crew/engine.js';
import { createDustExecutor } from '../crew/dust-executor.js';
import type { CrewAgentDef, CrewDef, CrewTaskDef } from '../crew/types.js';

const QUEUE_NAME = CREW_RUN.name;

const JobData = z.object({
  orgId: z.string().uuid(),
  crewId: z.string().uuid(),
  runId: z.string().uuid(),
  inputs: z.record(z.string()).default({}),
});
type JobData = z.infer<typeof JobData>;

interface CrewRow {
  process: string;
  manager_agent_key: string | null;
}
interface AgentRow {
  agent_key: string;
  role: string;
  goal: string;
  backstory: string;
  tools: unknown;
}
interface TaskRow {
  task_key: string;
  description: string;
  expected_output: string;
  agent_key: string;
  context_keys: unknown;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** Load a crew + its agents + tasks into a CrewDef. Returns null if not found. */
async function loadCrew(orgId: string, crewId: string): Promise<CrewDef | null> {
  const crews = await prisma.$queryRaw<CrewRow[]>`
    SELECT process, manager_agent_key
    FROM crews
    WHERE id = ${crewId}::uuid AND org_id = ${orgId}::uuid AND deleted_at IS NULL
    LIMIT 1
  `;
  const crew = crews[0];
  if (!crew) return null;

  const taskRows = await prisma.$queryRaw<TaskRow[]>`
    SELECT task_key, description, expected_output, agent_key, context_keys
    FROM crew_tasks
    WHERE crew_id = ${crewId}::uuid AND org_id = ${orgId}::uuid
    ORDER BY sort_order ASC, created_at ASC
  `;
  const agentRows = await prisma.$queryRaw<AgentRow[]>`
    SELECT agent_key, role, goal, backstory, tools
    FROM crew_agents
    WHERE org_id = ${orgId}::uuid AND deleted_at IS NULL
  `;

  const agents: CrewAgentDef[] = agentRows.map((a) => ({
    id: a.agent_key,
    role: a.role,
    goal: a.goal,
    backstory: a.backstory,
    tools: asStringArray(a.tools),
  }));
  const tasks: CrewTaskDef[] = taskRows.map((t) => {
    const ctx = asStringArray(t.context_keys);
    return {
      id: t.task_key,
      description: t.description,
      expectedOutput: t.expected_output,
      agentId: t.agent_key,
      // WHY empty -> undefined: an unset context_keys means "use the default"
      // (chain all prior outputs, CrewAI-style), which is the friendly default
      // for a sequential crew. An explicit allow-list is honored when non-empty.
      context: ctx.length > 0 ? ctx : undefined,
    };
  });

  // CrewDef.managerAgentId holds the manager agent's KEY (agents are keyed by
  // agent_key, and CrewAgentDef.id = agent_key).
  const def: CrewDef = {
    agents,
    tasks,
    process: crew.process === 'hierarchical' ? 'hierarchical' : 'sequential',
    managerAgentId: crew.manager_agent_key ?? undefined,
  };
  return def;
}

async function markFailed(orgId: string, runId: string, message: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE crew_runs
    SET status = 'failed', error = ${message.slice(0, 2000)}, completed_at = now()
    WHERE id = ${runId}::uuid AND org_id = ${orgId}::uuid
  `;
}

async function processJob(job: Job<JobData>, log: pino.Logger): Promise<void> {
  const parsed = JobData.safeParse(job.data);
  if (!parsed.success) throw new Error(`crew-run: invalid job data: ${parsed.error.message}`);
  const { orgId, crewId, runId, inputs } = parsed.data;

  await prisma.$executeRaw`
    UPDATE crew_runs SET status = 'running'
    WHERE id = ${runId}::uuid AND org_id = ${orgId}::uuid
  `;

  const crew = await loadCrew(orgId, crewId);
  if (!crew) {
    await markFailed(orgId, runId, 'crew not found');
    const err = new Error(`crew-run: crew ${crewId} not found for org`);
    (err as Error & { doNotRetry?: boolean }).doNotRetry = true;
    throw err;
  }

  try {
    const result = await kickoff(crew, inputs, await createDustExecutor(log, orgId));
    await prisma.$executeRaw`
      UPDATE crew_runs SET
        status = ${result.ok ? 'completed' : 'partial'},
        final_output = ${result.finalOutput},
        results = ${JSON.stringify(result.results)}::jsonb,
        completed_at = now()
      WHERE id = ${runId}::uuid AND org_id = ${orgId}::uuid
    `;
    log.info(
      { orgId, crewId, runId, ok: result.ok, tasks: result.results.length },
      'crew-run: complete',
    );
  } catch (err) {
    // kickoff throws only on a bad DEFINITION (validateCrew) — terminal, don't retry.
    const msg = err instanceof Error ? err.message : 'crew run error';
    await markFailed(orgId, runId, msg);
    const e = new Error(`crew-run failed: ${msg}`);
    (e as Error & { doNotRetry?: boolean }).doNotRetry = true;
    throw e;
  }
}

export async function startCrewRun(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  _queues: Queue[],
): Promise<void> {
  const worker = new BullWorker<JobData>(
    QUEUE_NAME,
    async (job) => processJob(job, log.child({ jobId: job.id })),
    { connection, concurrency: 2, limiter: { max: 20, duration: 60_000 } },
  );
  worker.on('completed', (job) => log.info({ jobId: job.id }, 'crew-run: completed'));
  worker.on('failed', (job, err) => log.error({ jobId: job?.id, err }, 'crew-run: failed'));
  workers.push(worker);
  log.info({ queue: QUEUE_NAME }, 'crew-run worker started');
}

// ─── Stuck-run reaper ────────────────────────────────────────────────────────

const REAPER_QUEUE = 'crew-run-reaper';
const REAPER_EVERY_MS = 5 * 60 * 1000;

/**
 * Sweep crew runs stuck in queued/running past a 15-minute SLA and mark them
 * failed, so a run whose worker died mid-flight (or whose job was lost) stops
 * sitting "running" forever in the UI and the caller can retry. System-wide +
 * idempotent: the WHERE clause never touches already-terminal runs, so it's
 * safe even if multiple worker instances run it. `interval '15 minutes'` is a
 * SQL literal (no interpolation).
 */
async function reapStuckRuns(log: pino.Logger): Promise<void> {
  const reaped = await prisma.$executeRaw`
    UPDATE crew_runs
    SET status = 'failed',
        error = 'Run exceeded the 15-minute limit and was marked failed',
        completed_at = now()
    WHERE status IN ('queued', 'running')
      AND created_at < now() - interval '15 minutes'
  `;
  if (reaped > 0) log.warn({ reaped }, 'crew-run reaper: marked stuck runs failed');
}

export async function startCrewRunReaper(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
): Promise<void> {
  const queue = new BullQueue(REAPER_QUEUE, { connection });
  queues.push(queue);
  await queue.add(
    'crew-run.reap',
    {},
    {
      repeat: { every: REAPER_EVERY_MS },
      removeOnComplete: { age: 3600, count: 50 },
      removeOnFail: { age: 86400 },
    },
  );
  const worker = new BullWorker(
    REAPER_QUEUE,
    async () => reapStuckRuns(log.child({ kind: 'crew-reaper' })),
    {
      connection,
    },
  );
  worker.on('failed', (job, err) => log.error({ jobId: job?.id, err }, 'crew-run reaper: failed'));
  workers.push(worker);
  log.info({ queue: REAPER_QUEUE }, 'crew-run reaper started');
}

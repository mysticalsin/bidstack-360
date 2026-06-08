// Crew + run infrastructure routes — Wave 10.
//
// RBAC: admins CREATE / EDIT / DELETE crews (and their tasks); any authenticated
// member may LIST/GET a crew and RUN it. Runs are owner-scoped on read (a member
// sees only their own runs; admins see all) — mirrors the proposal model. Crew
// tables are accessed via parameterized raw SQL (not in the generated client).

import type { FastifyPluginAsync } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma, type Prisma } from '@bidstack/db';

import { cancelQueuedCrewRun, enqueueCrewRun } from '../queues/crew-run.js';
import { seedStandardCrew } from '../lib/crew-standard.js';

// ─── Row shapes + serializers ───────────────────────────────────────────────

interface CrewRow {
  id: string;
  name: string;
  description: string | null;
  process: string;
  manager_agent_key: string | null;
  created_at: Date;
  updated_at: Date;
}
interface TaskRow {
  task_key: string;
  description: string;
  expected_output: string;
  agent_key: string;
  context_keys: unknown;
  sort_order: number;
}
interface RunRow {
  id: string;
  crew_id: string;
  started_by_user_id: string | null;
  status: string;
  inputs: unknown;
  final_output: string | null;
  results: unknown;
  error: string | null;
  created_at: Date;
  completed_at: Date | null;
}

function serializeCrew(c: CrewRow, tasks: TaskRow[]) {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    process: c.process,
    managerAgentKey: c.manager_agent_key,
    createdAt: c.created_at.toISOString(),
    updatedAt: c.updated_at.toISOString(),
    tasks: tasks
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((t) => ({
        taskKey: t.task_key,
        description: t.description,
        expectedOutput: t.expected_output,
        agentKey: t.agent_key,
        contextKeys: Array.isArray(t.context_keys) ? (t.context_keys as string[]) : [],
      })),
  };
}

function asRunInputs(inputs: unknown): Record<string, string> {
  if (typeof inputs !== 'object' || inputs === null || Array.isArray(inputs)) return {};
  return Object.fromEntries(
    Object.entries(inputs).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function serializeRun(r: RunRow, isAdmin: boolean) {
  return {
    id: r.id,
    crewId: r.crew_id,
    startedByUserId: r.started_by_user_id,
    status: r.status,
    inputs: asRunInputs(r.inputs),
    finalOutput: r.final_output,
    results: r.results ?? null,
    // Raw error text can carry LLM/internal detail. Only admins see it; members
    // get a coarse signal so they know it failed without leaking specifics.
    error: r.error === null ? null : isAdmin ? r.error : 'Run failed — ask an admin for details',
    createdAt: r.created_at.toISOString(),
    completedAt: r.completed_at?.toISOString() ?? null,
  };
}

// Bounds on crew run inputs — defense against oversized/abusive payloads that
// would bloat the job, the prompt, and the LLM bill. Enforced at the edge so
// the worker never receives an unbounded blob.
const MAX_INPUT_KEYS = 20;
const MAX_INPUT_VALUE_CHARS = 20_000;
const MAX_INPUT_TOTAL_CHARS = 100_000;
const ACTIVE_RUN_STATUSES = ['queued', 'running'] as const;
const RETRYABLE_RUN_STATUSES = ['failed', 'cancelled', 'partial'] as const;
const RunInputs = z
  .record(
    z.string().max(MAX_INPUT_VALUE_CHARS, `Each value must be ≤ ${MAX_INPUT_VALUE_CHARS} chars`),
  )
  .default({})
  .superRefine((inputs, ctx) => {
    if (Object.keys(inputs).length > MAX_INPUT_KEYS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `At most ${MAX_INPUT_KEYS} input keys are allowed`,
      });
    }
    const total = Object.values(inputs).reduce((n, v) => n + v.length, 0);
    if (total > MAX_INPUT_TOTAL_CHARS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Total input size must be ≤ ${MAX_INPUT_TOTAL_CHARS} chars`,
      });
    }
  });

// ─── Validation ─────────────────────────────────────────────────────────────

const Key = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9_-]+$/, 'lowercase letters, digits, - and _ only');

const CrewTaskInput = z.object({
  taskKey: Key,
  description: z.string().min(1).max(4000),
  expectedOutput: z.string().min(1).max(2000),
  agentKey: z.string().min(1).max(100),
  contextKeys: z.array(z.string().max(100)).max(20).default([]),
});
const CrewBody = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    process: z.enum(['sequential', 'hierarchical']).default('sequential'),
    managerAgentKey: z.string().max(100).optional(),
    tasks: z.array(CrewTaskInput).max(50).default([]),
  })
  .superRefine((b, ctx) => {
    // Mirror the engine's validateCrew so a malformed crew is a 400 at authoring
    // time, not a failed run later: unique task keys + context refs only to
    // EARLIER tasks (prevents forward refs / cycles) + no duplicate context keys.
    const seen = new Set<string>();
    b.tasks.forEach((t, i) => {
      if (seen.has(t.taskKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate task key "${t.taskKey}"`,
          path: ['tasks', i, 'taskKey'],
        });
      }
      if (new Set(t.contextKeys).size !== t.contextKeys.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `task "${t.taskKey}" has duplicate context keys`,
          path: ['tasks', i, 'contextKeys'],
        });
      }
      for (const c of t.contextKeys) {
        if (!seen.has(c)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `task "${t.taskKey}" context "${c}" must reference an earlier task`,
            path: ['tasks', i, 'contextKeys'],
          });
        }
      }
      seen.add(t.taskKey);
    });
  });

const CrewResponse = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  process: z.string(),
  managerAgentKey: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  tasks: z.array(
    z.object({
      taskKey: z.string(),
      description: z.string(),
      expectedOutput: z.string(),
      agentKey: z.string(),
      contextKeys: z.array(z.string()),
    })
  ),
});

const CrewListResponse = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  process: z.string(),
  managerAgentKey: z.string().nullable(),
  taskCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const RunResponse = z.object({
  id: z.string().uuid(),
  crewId: z.string().uuid(),
  startedByUserId: z.string().uuid().nullable(),
  status: z.string(),
  inputs: z.record(z.string()),
  finalOutput: z.string().nullable(),
  results: z.unknown().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

async function insertTasks(
  tx: Prisma.TransactionClient,
  orgId: string,
  crewId: string,
  tasks: z.infer<typeof CrewTaskInput>[],
): Promise<void> {
  for (const [i, t] of tasks.entries()) {
    // Ordered insert preserves sort_order.
    await tx.$executeRaw`
      INSERT INTO crew_tasks
        (id, org_id, crew_id, task_key, description, expected_output, agent_key, context_keys, sort_order, created_at, updated_at)
      VALUES
        (gen_random_uuid(), ${orgId}::uuid, ${crewId}::uuid, ${t.taskKey}, ${t.description},
         ${t.expectedOutput}, ${t.agentKey}, ${JSON.stringify(t.contextKeys)}::jsonb, ${i}, now(), now())
    `;
  }
}

async function loadCrew(orgId: string, crewId: string) {
  const crews = await prisma.$queryRaw<CrewRow[]>`
    SELECT id, name, description, process, manager_agent_key, created_at, updated_at
    FROM crews WHERE id = ${crewId}::uuid AND org_id = ${orgId}::uuid AND deleted_at IS NULL LIMIT 1
  `;
  const crew = crews[0];
  if (!crew) return null;
  const tasks = await prisma.$queryRaw<TaskRow[]>`
    SELECT task_key, description, expected_output, agent_key, context_keys, sort_order
    FROM crew_tasks WHERE crew_id = ${crewId}::uuid AND org_id = ${orgId}::uuid
    ORDER BY sort_order ASC
  `;
  return serializeCrew(crew, tasks);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Accept a caller id only if it's a real UUID. API-key sessions use a non-UUID
 *  actor id ("apikey:<id>") that must never be cast to ::uuid (would 500). A
 *  null owner is invisible to non-admins on read, which is the safe default. */
function uuidOrNull(v: string | null | undefined): string | null {
  return v && UUID_RE.test(v) ? v : null;
}

async function loadRunForAction(
  orgId: string,
  userId: string | null | undefined,
  isAdmin: boolean,
  runId: string,
): Promise<RunRow | null> {
  const callerId = uuidOrNull(userId);
  const rows = await prisma.$queryRaw<RunRow[]>`
    SELECT id, crew_id, started_by_user_id, status, inputs, final_output, results, error, created_at, completed_at
    FROM crew_runs
    WHERE id = ${runId}::uuid AND org_id = ${orgId}::uuid
      AND (${isAdmin} OR started_by_user_id = ${callerId}::uuid)
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function writeCrewRunAudit(
  orgId: string,
  userId: string | null | undefined,
  action: 'crew.run.cancel' | 'crew.run.retry',
  runId: string,
  diff: Prisma.InputJsonObject,
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      orgId,
      userId: uuidOrNull(userId),
      action,
      targetType: 'crew_run',
      targetId: runId,
      diff,
    },
  });
}

/** Agent keys referenced by a crew body that don't exist (active) in the org —
 *  so the handler can 400 at authoring time instead of failing the run at kickoff. */
async function missingAgentKeys(orgId: string, body: z.infer<typeof CrewBody>): Promise<string[]> {
  const needed = new Set<string>(body.tasks.map((t) => t.agentKey));
  if (body.process === 'hierarchical' && body.managerAgentKey) needed.add(body.managerAgentKey);
  if (needed.size === 0) return [];
  const rows = await prisma.$queryRaw<{ agent_key: string }[]>`
    SELECT agent_key FROM crew_agents WHERE org_id = ${orgId}::uuid AND deleted_at IS NULL
  `;
  const have = new Set(rows.map((r) => r.agent_key));
  return [...needed].filter((k) => !have.has(k));
}

// ─── Routes ─────────────────────────────────────────────────────────────────

export const crewRoutes: FastifyPluginAsync = async (server) => {
  const app = server.withTypeProvider<ZodTypeProvider>();
  const admin = server.requireRole('admin');

  // GET /crews — list crews with task counts (any member).
  app.get(
    '/crews',
    { schema: { response: { 200: z.object({ items: z.array(CrewListResponse) }) } } },
    async (req) => {
    const rows = await prisma.$queryRaw<(CrewRow & { task_count: bigint })[]>`
      SELECT c.id, c.name, c.description, c.process, c.manager_agent_key, c.created_at, c.updated_at,
             (SELECT count(*) FROM crew_tasks t WHERE t.crew_id = c.id) AS task_count
      FROM crews c
      WHERE c.org_id = ${req.auth.orgId}::uuid AND c.deleted_at IS NULL
      ORDER BY c.updated_at DESC
    `;
    return {
      items: rows.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        process: c.process,
        managerAgentKey: c.manager_agent_key,
        taskCount: Number(c.task_count),
        createdAt: c.created_at.toISOString(),
        updatedAt: c.updated_at.toISOString(),
      })),
    };
  });

  // GET /crews/:id — crew + ordered tasks (any member).
  app.get(
    '/crews/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: CrewResponse },
      },
    },
    async (req) => {
      const crew = await loadCrew(req.auth.orgId, req.params.id);
      if (!crew) throw server.httpErrors.notFound('Crew not found');
      return crew;
    },
  );

  // POST /crews — create crew + tasks (admin only).
  app.post(
    '/crews',
    { preHandler: admin, schema: { body: CrewBody, response: { 201: CrewResponse } } },
    async (req, reply) => {
    const { orgId, userId } = req.auth;
    const b = req.body;
    const missing = await missingAgentKeys(orgId, b);
    if (missing.length > 0) {
      throw server.httpErrors.badRequest(`Unknown agent key(s): ${missing.join(', ')}`);
    }
    const createdBy = uuidOrNull(userId);
    const crewId = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO crews
          (id, org_id, name, description, process, manager_agent_key, created_by_user_id, created_at, updated_at)
        VALUES
          (gen_random_uuid(), ${orgId}::uuid, ${b.name}, ${b.description ?? null}, ${b.process},
           ${b.managerAgentKey ?? null}, ${createdBy}::uuid, now(), now())
        RETURNING id
      `;
      const id = rows[0]?.id;
      if (!id) throw server.httpErrors.internalServerError('Crew insert returned no row');
      await insertTasks(tx, orgId, id, b.tasks);
      return id;
    });
    const crew = await loadCrew(orgId, crewId);
    if (!crew) throw server.httpErrors.internalServerError('Failed to load created crew');
    reply.status(201);
    return crew;
  });

  // PATCH /crews/:id — update crew + replace its tasks (admin only).
  app.patch(
    '/crews/:id',
    {
      preHandler: admin,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: CrewBody,
        response: { 200: CrewResponse },
      },
    },
    async (req) => {
      const { orgId } = req.auth;
      const { id } = req.params;
      const b = req.body;
      const missing = await missingAgentKeys(orgId, b);
      if (missing.length > 0) {
        throw server.httpErrors.badRequest(`Unknown agent key(s): ${missing.join(', ')}`);
      }
      const ok = await prisma.$transaction(async (tx) => {
        const updated = await tx.$executeRaw`
          UPDATE crews SET
            name = ${b.name}, description = ${b.description ?? null}, process = ${b.process},
            manager_agent_key = ${b.managerAgentKey ?? null}, updated_at = now()
          WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid AND deleted_at IS NULL
        `;
        if (updated === 0) return false;
        await tx.$executeRaw`
          DELETE FROM crew_tasks WHERE crew_id = ${id}::uuid AND org_id = ${orgId}::uuid
        `;
        await insertTasks(tx, orgId, id, b.tasks);
        return true;
      });
      if (!ok) throw server.httpErrors.notFound('Crew not found');
      const crew = await loadCrew(orgId, id);
      if (!crew) throw server.httpErrors.internalServerError('Failed to load updated crew');
      return crew;
    },
  );

  // DELETE /crews/:id — soft-delete (admin only).
  app.delete(
    '/crews/:id',
    {
      preHandler: admin,
      schema: { params: z.object({ id: z.string().uuid() }), response: { 204: z.null() } },
    },
    async (req, reply) => {
      const affected = await prisma.$executeRaw`
        UPDATE crews SET deleted_at = now()
        WHERE id = ${req.params.id}::uuid AND org_id = ${req.auth.orgId}::uuid AND deleted_at IS NULL
      `;
      if (affected === 0) throw server.httpErrors.notFound('Crew not found');
      reply.status(204);
      return null;
    },
  );

  // POST /crews/seed-standard — load the out-of-the-box standard agents + the
  // default RFP-response crew for this org (admin only). Idempotent.
  app.post(
    '/crews/seed-standard',
    { preHandler: admin, schema: { response: { 201: CrewResponse } } },
    async (req, reply) => {
    const crewId = await seedStandardCrew(req.auth.orgId, req.auth.userId);
    const crew = await loadCrew(req.auth.orgId, crewId);
    if (!crew) throw server.httpErrors.internalServerError('Failed to load seeded crew');
    reply.status(201);
    return crew;
  });

  // POST /crews/:id/run — run a crew (any member). Creates a CrewRun + enqueues.
  app.post(
    '/crews/:id/run',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ inputs: RunInputs }),
        response: { 202: z.object({ runId: z.string().uuid(), status: z.string() }) },
      },
    },
    async (req, reply) => {
      const { orgId } = req.auth;
      const crew = await loadCrew(orgId, req.params.id);
      if (!crew) throw server.httpErrors.notFound('Crew not found');

      const startedBy = uuidOrNull(req.auth.userId);
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO crew_runs (id, org_id, crew_id, started_by_user_id, status, inputs, created_at)
        VALUES (gen_random_uuid(), ${orgId}::uuid, ${req.params.id}::uuid, ${startedBy}::uuid, 'queued',
                ${JSON.stringify(req.body.inputs)}::jsonb, now())
        RETURNING id
      `;
      const runId = rows[0]?.id;
      if (!runId) throw server.httpErrors.internalServerError('Run insert returned no row');

      const jobId = await enqueueCrewRun({
        orgId,
        crewId: req.params.id,
        runId,
        inputs: req.body.inputs,
      });
      if (!jobId) {
        // Redis unreachable — without a job the run would sit 'queued' forever.
        // Make it terminal and fail loud so the user can retry (CLAUDE.md Rule 12).
        await prisma.$executeRaw`
          UPDATE crew_runs SET status = 'failed', error = 'Run queue unavailable — please retry', completed_at = now()
          WHERE id = ${runId}::uuid AND org_id = ${orgId}::uuid
        `;
        throw server.httpErrors.serviceUnavailable('Run queue unavailable — please retry');
      }
      reply.status(202);
      return { runId, status: 'queued' as const };
    },
  );

  // POST /crew-runs/:id/cancel — transition queued/running runs to cancelled.
  app.post(
    '/crew-runs/:id/cancel',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: RunResponse },
      },
    },
    async (req) => {
      const isAdmin = req.auth.role === 'admin';
      const run = await loadRunForAction(req.auth.orgId, req.auth.userId, isAdmin, req.params.id);
      if (!run) throw server.httpErrors.notFound('Run not found');
      if (!ACTIVE_RUN_STATUSES.includes(run.status as (typeof ACTIVE_RUN_STATUSES)[number])) {
        throw server.httpErrors.conflict(`Crew run cannot be cancelled from ${run.status}`);
      }

      if (run.status === 'queued') {
        const removed = await cancelQueuedCrewRun(run.id);
        if (!removed) {
          throw server.httpErrors.conflict('Queued crew run is already active; retry status refresh');
        }
      }

      const rows = await prisma.$queryRaw<RunRow[]>`
        UPDATE crew_runs
        SET status = 'cancelled', error = 'Cancelled by user', completed_at = now()
        WHERE id = ${run.id}::uuid AND org_id = ${req.auth.orgId}::uuid
          AND status IN ('queued', 'running')
        RETURNING id, crew_id, started_by_user_id, status, inputs, final_output, results, error, created_at, completed_at
      `;
      const updated = rows[0];
      if (!updated) throw server.httpErrors.conflict('Crew run changed state; refresh before cancelling');

      await writeCrewRunAudit(req.auth.orgId, req.auth.userId, 'crew.run.cancel', run.id, {
        crewId: run.crew_id,
        previousStatus: run.status,
        status: 'cancelled',
      });
      return serializeRun(updated, isAdmin);
    },
  );

  // POST /crew-runs/:id/retry — enqueue a new run with the original bounded inputs.
  app.post(
    '/crew-runs/:id/retry',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 202: z.object({ runId: z.string().uuid(), status: z.string() }) },
      },
    },
    async (req, reply) => {
      const isAdmin = req.auth.role === 'admin';
      const run = await loadRunForAction(req.auth.orgId, req.auth.userId, isAdmin, req.params.id);
      if (!run) throw server.httpErrors.notFound('Run not found');
      if (!RETRYABLE_RUN_STATUSES.includes(run.status as (typeof RETRYABLE_RUN_STATUSES)[number])) {
        throw server.httpErrors.conflict(`Crew run cannot be retried from ${run.status}`);
      }
      const crew = await loadCrew(req.auth.orgId, run.crew_id);
      if (!crew) throw server.httpErrors.notFound('Crew not found');

      const inputs = asRunInputs(run.inputs);
      const startedBy = uuidOrNull(req.auth.userId);
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO crew_runs (id, org_id, crew_id, started_by_user_id, status, inputs, created_at)
        VALUES (gen_random_uuid(), ${req.auth.orgId}::uuid, ${run.crew_id}::uuid, ${startedBy}::uuid,
                'queued', ${JSON.stringify(inputs)}::jsonb, now())
        RETURNING id
      `;
      const newRunId = rows[0]?.id;
      if (!newRunId) throw server.httpErrors.internalServerError('Run insert returned no row');

      const jobId = await enqueueCrewRun({
        orgId: req.auth.orgId,
        crewId: run.crew_id,
        runId: newRunId,
        inputs,
      });
      if (!jobId) {
        await prisma.$executeRaw`
          UPDATE crew_runs SET status = 'failed', error = 'Run queue unavailable — please retry', completed_at = now()
          WHERE id = ${newRunId}::uuid AND org_id = ${req.auth.orgId}::uuid
        `;
        throw server.httpErrors.serviceUnavailable('Run queue unavailable — please retry');
      }

      await writeCrewRunAudit(req.auth.orgId, req.auth.userId, 'crew.run.retry', run.id, {
        crewId: run.crew_id,
        previousRunId: run.id,
        newRunId,
        previousStatus: run.status,
      });
      reply.status(202);
      return { runId: newRunId, status: 'queued' as const };
    },
  );

  // GET /crew-runs/:id — a single run (owner-or-admin).
  app.get(
    '/crew-runs/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: RunResponse },
      },
    },
    async (req) => {
      const isAdmin = req.auth.role === 'admin';
      const callerId = uuidOrNull(req.auth.userId);
      const rows = await prisma.$queryRaw<RunRow[]>`
        SELECT id, crew_id, started_by_user_id, status, inputs, final_output, results, error, created_at, completed_at
        FROM crew_runs
        WHERE id = ${req.params.id}::uuid AND org_id = ${req.auth.orgId}::uuid
          AND (${isAdmin} OR started_by_user_id = ${callerId}::uuid)
        LIMIT 1
      `;
      const run = rows[0];
      if (!run) throw server.httpErrors.notFound('Run not found');
      return serializeRun(run, isAdmin);
    },
  );

  // GET /crew-runs?crewId= — list runs (owner-or-admin scoped).
  app.get(
    '/crew-runs',
    {
      schema: {
        querystring: z.object({ crewId: z.string().uuid().optional() }),
        response: { 200: z.object({ items: z.array(RunResponse) }) },
      },
    },
    async (req) => {
      const isAdmin = req.auth.role === 'admin';
      const callerId = uuidOrNull(req.auth.userId);
      const { crewId } = req.query;
      const rows = await prisma.$queryRaw<RunRow[]>`
        SELECT id, crew_id, started_by_user_id, status, inputs, final_output, results, error, created_at, completed_at
        FROM crew_runs
        WHERE org_id = ${req.auth.orgId}::uuid
          AND (${isAdmin} OR started_by_user_id = ${callerId}::uuid)
          AND (${crewId ?? null}::uuid IS NULL OR crew_id = ${crewId ?? null}::uuid)
        ORDER BY created_at DESC
        LIMIT 100
      `;
      return { items: rows.map((r) => serializeRun(r, isAdmin)) };
    },
  );
};

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma, type Prisma } from '@bidstack/db';
import { Workflow, WorkflowRun, WorkflowCreate, runWorkflowActions } from '@bidstack/shared';
import type { WorkflowActionKind, WorkflowTriggerKind } from '@bidstack/shared';

import { apiWorkflowEffects } from '../services/workflows/workflow-engine.service.js';

export const workflowRoutes: FastifyPluginAsyncZod = async (server) => {

  // RBAC: gate every route in this plugin by method — writes need 'workflows:write',
  // reads need 'workflows:read'. Runs after the global auth onRequest.
  server.addHook('preHandler', async (req) => {
    const isWrite = req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE';
    await server.requirePermission(isWrite ? 'workflows:write' : 'workflows:read')(req);
  });
  // GET /api/workflows
  server.get(
    '/workflows',
    {
      schema: {
        querystring: z.object({
          active: z.coerce.boolean().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
        response: { 200: z.object({ items: z.array(Workflow) }) },
      },
    },
    async (req) => {
      const rows = await prisma.workflow.findMany({
        where: {
          orgId: req.auth.orgId,
          deletedAt: null,
          ...(req.query.active !== undefined ? { active: req.query.active } : {}),
        },
        include: { actions: { orderBy: { sortOrder: 'asc' } } },
        orderBy: { updatedAt: 'desc' },
        take: req.query.limit,
      });
      return { items: rows.map(serializeWorkflow) };
    },
  );

  // POST /api/workflows
  server.post(
    '/workflows',
    {
      schema: {
        body: WorkflowCreate,
        response: { 201: Workflow },
      },
    },
    async (req, reply) => {
      // Verify assigneeIds belong to the current orgId (BS-15)
      for (const a of req.body.actions) {
        if (a.kind === 'create_task') {
          const config = a.config as Record<string, unknown> | null;
          if (config && typeof config.assigneeId === 'string') {
            const assignee = await prisma.user.findFirst({
              where: { id: config.assigneeId, orgId: req.auth.orgId },
            });
            if (!assignee) {
              throw server.httpErrors.badRequest(
                `Assignee ${config.assigneeId} does not belong to your organization`,
              );
            }
          }
        }
      }

      const created = await prisma.workflow.create({
        data: {
          orgId: req.auth.orgId,
          name: req.body.name,
          description: req.body.description,
          active: req.body.active,
          triggerKind: req.body.triggerKind,
          triggerConfig: req.body.triggerConfig as Prisma.InputJsonValue,
          actions: {
            create: req.body.actions.map((a) => ({
              orgId: req.auth.orgId,
              kind: a.kind,
              config: a.config as Prisma.InputJsonValue,
              sortOrder: a.sortOrder,
            })),
          },
        },
        include: { actions: { orderBy: { sortOrder: 'asc' } } },
      });
      return reply.code(201).send(serializeWorkflow(created));
    },
  );

  // GET /api/workflows/:id
  server.get(
    '/workflows/:id',
    {
      schema: { params: z.object({ id: z.string().uuid() }), response: { 200: Workflow } },
    },
    async (req) => {
      const row = await prisma.workflow.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        include: { actions: { orderBy: { sortOrder: 'asc' } } },
      });
      if (!row) throw server.httpErrors.notFound('Workflow not found');
      return serializeWorkflow(row);
    },
  );

  // PATCH /api/workflows/:id
  server.patch(
    '/workflows/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: WorkflowCreate.partial(),
        response: { 200: Workflow },
      },
    },
    async (req) => {
      const existing = await prisma.workflow.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
      });
      if (!existing) throw server.httpErrors.notFound('Workflow not found');

      if (req.body.actions) {
        for (const a of req.body.actions) {
          if (a.kind === 'create_task') {
            const config = a.config as Record<string, unknown> | null;
            if (config && typeof config.assigneeId === 'string') {
              const assignee = await prisma.user.findFirst({
                where: { id: config.assigneeId, orgId: req.auth.orgId },
              });
              if (!assignee) {
                throw server.httpErrors.badRequest(
                  `Assignee ${config.assigneeId} does not belong to your organization`,
                );
              }
            }
          }
        }
      }

      await prisma.$transaction(async (tx) => {
        const updateResult = await tx.workflow.updateMany({
          where: { id: existing.id, orgId: req.auth.orgId, deletedAt: null },
          data: {
            ...(req.body.name !== undefined ? { name: req.body.name } : {}),
            ...(req.body.description !== undefined ? { description: req.body.description } : {}),
            ...(req.body.active !== undefined ? { active: req.body.active } : {}),
            ...(req.body.triggerKind ? { triggerKind: req.body.triggerKind } : {}),
            ...(req.body.triggerConfig
              ? { triggerConfig: req.body.triggerConfig as Prisma.InputJsonValue }
              : {}),
          },
        });

        if (updateResult.count === 0) {
          throw server.httpErrors.notFound('Workflow not found');
        }

        // Persist action edits — when `actions` is provided, replace the full set.
        // Previously the actions were validated above but never written, so edits
        // were silently dropped. (Review finding, 2026-06-04.)
        if (req.body.actions !== undefined) {
          await tx.workflowAction.deleteMany({
            where: { workflowId: existing.id, orgId: req.auth.orgId },
          });
          if (req.body.actions.length > 0) {
            await tx.workflowAction.createMany({
              data: req.body.actions.map((a) => ({
                workflowId: existing.id,
                orgId: req.auth.orgId,
                kind: a.kind,
                config: a.config as Prisma.InputJsonValue,
                sortOrder: a.sortOrder,
              })),
            });
          }
        }
      });

      const updated = await prisma.workflow.findFirstOrThrow({
        where: { id: existing.id, orgId: req.auth.orgId, deletedAt: null },
        include: { actions: { orderBy: { sortOrder: 'asc' } } },
      });
      return serializeWorkflow(updated);
    },
  );

  // DELETE /api/workflows/:id
  server.delete(
    '/workflows/:id',
    {
      schema: { params: z.object({ id: z.string().uuid() }), response: { 204: z.null() } },
    },
    async (req, reply) => {
      const existing = await prisma.workflow.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
      });
      if (!existing) throw server.httpErrors.notFound('Workflow not found');
      const updateResult = await prisma.workflow.updateMany({
        where: { id: existing.id, orgId: req.auth.orgId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (updateResult.count === 0) {
        throw server.httpErrors.notFound('Workflow not found');
      }
      return reply.code(204).send(null);
    },
  );

  // POST /api/workflows/:id/run
  server.post(
    '/workflows/:id/run',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ input: z.record(z.unknown()).default({}) }),
        response: { 200: WorkflowRun },
      },
    },
    async (req) => {
      const wf = await prisma.workflow.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        include: { actions: { orderBy: { sortOrder: 'asc' } } },
      });
      if (!wf) throw server.httpErrors.notFound('Workflow not found');

      const run = await prisma.workflowRun.create({
        data: {
          orgId: req.auth.orgId,
          workflowId: wf.id,
          status: 'running',
          input: req.body.input as Prisma.InputJsonValue,
        },
      });

      // Manual run shares the SAME engine the worker uses for trigger/schedule
      // dispatch (one code path). Per-step results are keyed by step — the
      // WorkflowRun.output schema is `z.record()` (an object), so a bare array
      // would trip the response serializer. A throwing step stops the run.
      const { outputs, error } = await runWorkflowActions(
        wf.actions.map((a) => ({
          kind: a.kind as z.infer<typeof WorkflowActionKind>,
          config: (a.config ?? {}) as Record<string, unknown>,
        })),
        { orgId: req.auth.orgId, input: req.body.input as Record<string, unknown> },
        apiWorkflowEffects,
      );

      const finalStatus: z.infer<typeof WorkflowRun>['status'] = error ? 'failed' : 'succeeded';
      const finishedAt = new Date();
      await prisma.$transaction(async (tx) => {
        // Org-scope the run finalization (updateMany + count) like every other
        // tenant write — a bare update({ where: { id } }) skips the org filter.
        const { count } = await tx.workflowRun.updateMany({
          where: { id: run.id, orgId: req.auth.orgId },
          data: {
            status: finalStatus,
            output: outputs as Prisma.InputJsonValue,
            error,
            finishedAt,
          },
        });
        if (count !== 1) throw server.httpErrors.notFound('Workflow run not found');
        await tx.workflow.updateMany({
          where: { id: wf.id, orgId: req.auth.orgId },
          data: { runCount: { increment: 1 }, lastRunAt: new Date() },
        });
      });

      // updateMany returns no row; build the response from the created run plus
      // the finalization values we just persisted (all org-scoped, in scope).
      return {
        id: run.id,
        orgId: run.orgId,
        workflowId: run.workflowId,
        status: finalStatus,
        triggerRecordType: run.triggerRecordType,
        triggerRecordId: run.triggerRecordId,
        input: run.input as Record<string, unknown>,
        output: outputs as Record<string, unknown>,
        error,
        startedAt: run.startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
      };
    },
  );

  // GET /api/workflows/:id/runs
  server.get(
    '/workflows/:id/runs',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }),
        response: { 200: z.object({ items: z.array(WorkflowRun) }) },
      },
    },
    async (req) => {
      const rows = await prisma.workflowRun.findMany({
        where: { workflowId: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        orderBy: { startedAt: 'desc' },
        take: req.query.limit,
      });
      return {
        items: rows.map((r) => ({
          id: r.id,
          orgId: r.orgId,
          workflowId: r.workflowId,
          status: r.status as z.infer<typeof WorkflowRun>['status'],
          triggerRecordType: r.triggerRecordType,
          triggerRecordId: r.triggerRecordId,
          input: r.input as Record<string, unknown>,
          output: r.output as Record<string, unknown>,
          error: r.error,
          startedAt: r.startedAt.toISOString(),
          finishedAt: r.finishedAt?.toISOString() ?? null,
        })),
      };
    },
  );
};

function serializeWorkflow(row: {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  active: boolean;
  triggerKind: string;
  triggerConfig: Prisma.JsonValue;
  actions: Array<{
    id: string;
    orgId: string;
    workflowId: string;
    kind: string;
    config: Prisma.JsonValue;
    sortOrder: number;
    createdAt: Date;
  }>;
  runCount: number;
  lastRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): z.infer<typeof Workflow> {
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    description: row.description,
    active: row.active,
    triggerKind: row.triggerKind as z.infer<typeof WorkflowTriggerKind>,
    triggerConfig: row.triggerConfig as Record<string, unknown>,
    actions: row.actions.map((a) => ({
      id: a.id,
      workflowId: a.workflowId,
      orgId: a.orgId,
      kind: a.kind as z.infer<typeof WorkflowActionKind>,
      config: a.config as Record<string, unknown>,
      sortOrder: a.sortOrder,
      createdAt: a.createdAt.toISOString(),
    })),
    runCount: row.runCount,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}


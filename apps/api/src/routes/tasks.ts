import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import type { Prisma } from '@bidstack/db';
import { Task, TaskCreate, TaskFilter, TaskPage, TaskPatch, TaskSummary } from '@bidstack/shared';

import { fanOutWebhookEvent } from '../queues/webhook-delivery.js';

type TaskSummaryPayload = z.infer<typeof TaskSummary>;
type TaskSummaryCacheEntry = {
  expiresAt: number;
  promise: Promise<TaskSummaryPayload>;
};

const TASK_SUMMARY_CACHE_TTL_MS = 15_000;
const taskSummaryCache = new Map<string, TaskSummaryCacheEntry>();

function clearTaskSummaryCache(orgId: string): void {
  taskSummaryCache.delete(orgId);
}

async function buildTaskSummary(orgId: string): Promise<TaskSummaryPayload> {
  const today = new Date().toISOString().slice(0, 10);
  const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const rows = await prisma.$queryRaw<Array<TaskSummaryPayload>>`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status <> 'done')::int AS open,
      COUNT(*) FILTER (WHERE status <> 'done' AND due_date < ${today}::date)::int AS overdue,
      COUNT(*) FILTER (
        WHERE status <> 'done'
          AND due_date >= ${today}::date
          AND due_date < ${nextWeek}::date
      )::int AS "dueSoon"
    FROM tasks
    WHERE org_id = ${orgId}::uuid
      AND deleted_at IS NULL
  `;
  return rows[0] ?? { total: 0, open: 0, overdue: 0, dueSoon: 0 };
}

async function cachedTaskSummary(orgId: string): Promise<TaskSummaryPayload> {
  const now = Date.now();
  const cached = taskSummaryCache.get(orgId);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = buildTaskSummary(orgId);
  taskSummaryCache.set(orgId, { expiresAt: now + TASK_SUMMARY_CACHE_TTL_MS, promise });
  try {
    return await promise;
  } catch (err) {
    taskSummaryCache.delete(orgId);
    throw err;
  }
}

export const tasksRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/tasks',
    {
      schema: {
        querystring: TaskFilter,
        response: { 200: TaskPage },
      },
    },
    async (req) => {
      const { oppId, status, cursor, limit } = req.query;
      const items = await prisma.task.findMany({
        where: {
          orgId: req.auth.orgId,
          deletedAt: null,
          ...(oppId ? { oppId } : {}),
          ...(status ? { status } : {}),
        },
        include: { assignee: true },
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }],
        take: limit + 1,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      const hasMore = items.length > limit;
      const sliced = hasMore ? items.slice(0, -1) : items;
      const nextCursor = hasMore ? (sliced[sliced.length - 1]?.id ?? null) : null;
      return {
        items: sliced.map((t) => ({
          id: t.id,
          oppId: t.oppId,
          title: t.title,
          dueDate: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null,
          status: t.status,
          assignee: t.assignee?.email ?? null,
          createdAt: t.createdAt.toISOString(),
        })),
        nextCursor,
      };
    },
  );

  server.get(
    '/tasks/summary',
    {
      schema: {
        response: { 200: TaskSummary },
      },
    },
    async (req) => {
      return cachedTaskSummary(req.auth.orgId);
    },
  );

  server.get(
    '/tasks/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: Task },
      },
    },
    async (req) => {
      const task = await prisma.task.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        include: { assignee: true },
      });
      if (!task) throw server.httpErrors.notFound('Task not found');
      const customFieldValues = await prisma.customFieldValue.findMany({
        where: { orgId: req.auth.orgId, entityType: 'task', entityId: task.id },
        select: { id: true, definitionId: true, value: true },
      });
      return {
        id: task.id,
        oppId: task.oppId,
        title: task.title,
        dueDate: task.dueDate ? task.dueDate.toISOString().slice(0, 10) : null,
        status: task.status,
        assignee: task.assignee?.email ?? null,
        createdAt: task.createdAt.toISOString(),
        customFieldValues,
      };
    },
  );

  server.post(
    '/tasks',
    {
      // WHY: any org member with tasks:write can create a task; the
      // admin-vs-assignee ownership check only applies to mutations on
      // existing tasks (PATCH/DELETE below).
      preHandler: [server.requirePermission('tasks:write')],
      schema: {
        body: TaskCreate,
        response: { 201: Task },
      },
    },
    async (req, reply) => {
      const body = req.body;
      const assignee = body.assignee
        ? await prisma.user.findFirst({
            where: { orgId: req.auth.orgId, email: body.assignee },
          })
        : null;
      let oppId: string | null = null;
      if (body.oppId) {
        const opportunity = await prisma.opportunity.findFirst({
          where: { id: body.oppId, orgId: req.auth.orgId },
          select: { id: true },
        });
        if (!opportunity) throw server.httpErrors.badRequest('Opportunity not found in this org');
        oppId = opportunity.id;
      }
      const created = await prisma.task.create({
        data: {
          orgId: req.auth.orgId,
          oppId,
          title: body.title,
          dueDate: body.dueDate ? new Date(body.dueDate) : null,
          status: body.status,
          assigneeId: assignee?.id ?? null,
        },
        include: { assignee: true },
      });
      // Fan-out webhook event — fire-and-forget (fail-open).
      clearTaskSummaryCache(req.auth.orgId);
      void fanOutWebhookEvent(req.auth.orgId, 'task.created', {
        id: created.id,
        title: created.title,
        status: created.status,
        oppId: created.oppId,
      });
      return reply.code(201).send({
        id: created.id,
        oppId: created.oppId,
        title: created.title,
        dueDate: created.dueDate ? created.dueDate.toISOString().slice(0, 10) : null,
        status: created.status,
        assignee: created.assignee?.email ?? null,
        createdAt: created.createdAt.toISOString(),
      });
    },
  );

  server.patch(
    '/tasks/:id',
    {
      preHandler: [server.requirePermission('tasks:write')],
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: TaskPatch,
        response: { 200: Task },
      },
    },
    async (req) => {
      // Two-step find-then-update enforces multi-tenancy (Prisma's `update`
      // only matches a unique key; we need orgId in the filter too).
      const existing = await prisma.task.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true, assigneeId: true },
      });
      if (!existing) throw server.httpErrors.notFound('Task not found');

      const isAdmin = req.auth.role === 'admin';
      const isAssignee = existing.assigneeId === req.auth.userId;
      const isUnassigned = existing.assigneeId === null;
      if (!isAdmin && !isAssignee && !isUnassigned) {
        throw server.httpErrors.forbidden('You are not authorized to modify this task');
      }

      // Resolve assignee email -> userId in the same org (or unset if null).
      let assigneeId: string | null | undefined;
      if (req.body.assignee !== undefined) {
        if (req.body.assignee === null) {
          assigneeId = null;
        } else {
          const user = await prisma.user.findFirst({
            where: { orgId: req.auth.orgId, email: req.body.assignee },
            select: { id: true },
          });
          if (!user) throw server.httpErrors.badRequest('Assignee not found in this org');
          assigneeId = user.id;
        }
      }

      // BS-4: org-scope the update where clause. Even though `existing` was
      // found via an org-scoped findFirst, code-quality rule 7 mandates that
      // EVERY Prisma where on a tenant table includes orgId — no exceptions
      // for "we already checked." Two-step updateMany + findFirstOrThrow
      // gives us back the row plus the relation `include` (updateMany
      // doesn't support include).
      const updateResult = await prisma.task.updateMany({
        where: { id: existing.id, orgId: req.auth.orgId, deletedAt: null },
        data: {
          ...(req.body.title !== undefined ? { title: req.body.title } : {}),
          ...(req.body.dueDate !== undefined
            ? { dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null }
            : {}),
          ...(req.body.status !== undefined ? { status: req.body.status } : {}),
          ...(assigneeId !== undefined ? { assigneeId } : {}),
        },
      });
      if (updateResult.count === 0) throw server.httpErrors.notFound('Task not found');
      const updated = await prisma.task.findFirstOrThrow({
        where: { id: existing.id, orgId: req.auth.orgId, deletedAt: null },
        include: { assignee: true },
      });
      clearTaskSummaryCache(req.auth.orgId);
      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'task.update',
          targetType: 'task',
          targetId: updated.id,
          diff: req.body as object,
        },
      });

      if (req.body.customFieldValues !== undefined) {
        for (const { definitionId, value } of req.body.customFieldValues) {
          await prisma.customFieldValue.upsert({
            where: {
              orgId_entityType_entityId_definitionId: {
                orgId: req.auth.orgId,
                entityType: 'task',
                entityId: existing.id,
                definitionId,
              },
            },
            update: { value: value as Prisma.InputJsonValue },
            create: {
              orgId: req.auth.orgId,
              definitionId,
              entityType: 'task',
              entityId: existing.id,
              value: value as Prisma.InputJsonValue,
            },
          });
        }
      }

      // Fan-out task.completed when status transitions to 'done' — fire-and-forget.
      // WHY 'done': TaskStatus enum uses 'done', not 'completed'; map to the published event name.
      if (req.body.status === 'done' && updated.status === 'done') {
        void fanOutWebhookEvent(req.auth.orgId, 'task.completed', {
          id: updated.id,
          title: updated.title,
          oppId: updated.oppId,
        });
      }

      return {
        id: updated.id,
        oppId: updated.oppId,
        title: updated.title,
        dueDate: updated.dueDate ? updated.dueDate.toISOString().slice(0, 10) : null,
        status: updated.status,
        assignee: updated.assignee?.email ?? null,
        createdAt: updated.createdAt.toISOString(),
      };
    },
  );

  server.delete(
    '/tasks/:id',
    {
      preHandler: [server.requirePermission('tasks:write')],
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const existing = await prisma.task.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true, title: true, assigneeId: true },
      });
      if (!existing) throw server.httpErrors.notFound('Task not found');

      const isAdmin = req.auth.role === 'admin';
      const isAssignee = existing.assigneeId === req.auth.userId;
      const isUnassigned = existing.assigneeId === null;
      if (!isAdmin && !isAssignee && !isUnassigned) {
        throw server.httpErrors.forbidden('You are not authorized to delete this task');
      }

      // BS-4: org-scope the soft-delete update. updateMany is the only
      // way to constrain on `{ id, orgId }` together (Prisma's `update`
      // requires a unique field). count===0 falls through silently since
      // the prior findFirst proved the row exists in this org.
      await prisma.$transaction([
        prisma.task.updateMany({
          where: { id: existing.id, orgId: req.auth.orgId, deletedAt: null },
          data: { deletedAt: new Date() },
        }),
        prisma.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'task.delete',
            targetType: 'task',
            targetId: existing.id,
            diff: { title: existing.title },
          },
        }),
      ]);
      clearTaskSummaryCache(req.auth.orgId);
      return reply.code(204).send(null);
    },
  );
};

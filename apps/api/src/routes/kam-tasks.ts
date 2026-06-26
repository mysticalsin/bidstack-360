/**
 * kam-tasks.ts — Initiative-scoped KAM tasks + the per-account to-do roll-up.
 *
 * Tasks are the to-do items OM lacks. They attach to an Initiative, denormalize
 * the owning account (accountId) for the roll-up, and bump the Initiative's
 * lastActivityAt on every mutation (M3, blind set — never read-modify-write) so
 * staleness alerts stay honest. Every referenced id is org-validated (B3) and
 * the account is access-scoped (B4) via the shared guards.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma, type Prisma } from '@bidstack/db';
import {
  KamAccountTodos,
  KamTaskCreate,
  KamTaskDetail,
  KamTaskList,
  KamTaskPatch,
} from '@bidstack/shared';

import { assertCompanyVisible, assertUserInOrg } from './kam-access.js';

type TaskRow = Prisma.TaskGetPayload<Record<string, never>>;

function toTaskDetail(row: TaskRow): z.infer<typeof KamTaskDetail> {
  return {
    id: row.id,
    initiativeId: row.initiativeId,
    accountId: row.accountId,
    title: row.title,
    status: row.status,
    type: row.type,
    assigneeId: row.assigneeId,
    dueDate: row.dueDate ? row.dueDate.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Blind-set the initiative's lastActivityAt (M3 — no read-modify-write). */
async function bumpInitiative(initiativeId: string | null, orgId: string): Promise<void> {
  if (!initiativeId) return;
  await prisma.kamInitiative.updateMany({
    where: { id: initiativeId, orgId },
    data: { lastActivityAt: new Date() },
  });
}

export const kamTaskRoutes: FastifyPluginAsyncZod = async (server) => {
  /** Load a KAM initiative in the caller's org + assert account access. */
  async function loadInitiativeOr404(
    req: Parameters<typeof assertCompanyVisible>[1],
    initiativeId: string,
  ): Promise<{ id: string; companyId: string }> {
    const init = await prisma.kamInitiative.findFirst({
      where: { id: initiativeId, orgId: req.auth.orgId, deletedAt: null },
      select: { id: true, companyId: true },
    });
    if (!init) throw server.httpErrors.notFound('Initiative not found');
    await assertCompanyVisible(server, req, init.companyId);
    return init;
  }

  // ── Create a task under an initiative ────────────────────────────────────
  server.post(
    '/kam/initiatives/:initiativeId/tasks',
    {
      preHandler: server.requirePermission('kam:write'),
      schema: {
        params: z.object({ initiativeId: z.string().uuid() }),
        body: KamTaskCreate,
        response: { 201: KamTaskDetail },
      },
    },
    async (req, reply) => {
      const init = await loadInitiativeOr404(req, req.params.initiativeId);
      const body = req.body;
      if (body.assigneeId) await assertUserInOrg(server, req, body.assigneeId);
      const created = await prisma.task.create({
        data: {
          orgId: req.auth.orgId,
          initiativeId: init.id,
          accountId: init.companyId,
          title: body.title,
          status: 'open',
          type: body.type ?? null,
          assigneeId: body.assigneeId ?? null,
          dueDate: body.dueDate ? new Date(body.dueDate) : null,
        },
      });
      await bumpInitiative(init.id, req.auth.orgId);
      reply.code(201);
      return toTaskDetail(created);
    },
  );

  // ── List tasks for an initiative ─────────────────────────────────────────
  server.get(
    '/kam/initiatives/:initiativeId/tasks',
    {
      preHandler: server.requirePermission('kam:read'),
      schema: {
        params: z.object({ initiativeId: z.string().uuid() }),
        response: { 200: KamTaskList },
      },
    },
    async (req) => {
      const init = await loadInitiativeOr404(req, req.params.initiativeId);
      const rows = await prisma.task.findMany({
        where: { orgId: req.auth.orgId, initiativeId: init.id, deletedAt: null },
        orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
        take: 200,
      });
      return { items: rows.map(toTaskDetail) };
    },
  );

  // ── Patch a task (status, assignee, due, type) ───────────────────────────
  server.patch(
    '/kam/tasks/:id',
    {
      preHandler: server.requirePermission('kam:write'),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: KamTaskPatch,
        response: { 200: KamTaskDetail },
      },
    },
    async (req) => {
      const existing = await prisma.task.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
      });
      if (!existing || (!existing.initiativeId && !existing.accountId)) {
        throw server.httpErrors.notFound('KAM task not found');
      }
      if (existing.accountId) await assertCompanyVisible(server, req, existing.accountId);
      const body = req.body;
      if (body.assigneeId) await assertUserInOrg(server, req, body.assigneeId);
      const updated = await prisma.task.update({
        where: { id: existing.id },
        data: {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.type !== undefined ? { type: body.type } : {}),
          ...(body.assigneeId !== undefined ? { assigneeId: body.assigneeId } : {}),
          ...(body.dueDate !== undefined
            ? { dueDate: body.dueDate ? new Date(body.dueDate) : null }
            : {}),
        },
      });
      await bumpInitiative(existing.initiativeId, req.auth.orgId);
      return toTaskDetail(updated);
    },
  );

  // ── Soft-delete a task ───────────────────────────────────────────────────
  server.delete(
    '/kam/tasks/:id',
    {
      preHandler: server.requirePermission('kam:write'),
      schema: { params: z.object({ id: z.string().uuid() }), response: { 204: z.null() } },
    },
    async (req, reply) => {
      const existing = await prisma.task.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
      });
      if (!existing || (!existing.initiativeId && !existing.accountId)) {
        throw server.httpErrors.notFound('KAM task not found');
      }
      if (existing.accountId) await assertCompanyVisible(server, req, existing.accountId);
      await prisma.task.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
      await bumpInitiative(existing.initiativeId, req.auth.orgId);
      reply.code(204);
      return null;
    },
  );

  // ── Per-account to-do roll-up (the OM gap-closer) ────────────────────────
  server.get(
    '/kam/accounts/:companyId/todos',
    {
      preHandler: server.requirePermission('kam:read'),
      schema: {
        params: z.object({ companyId: z.string().uuid() }),
        response: { 200: KamAccountTodos },
      },
    },
    async (req) => {
      const { companyId } = req.params;
      await assertCompanyVisible(server, req, companyId);
      // Bounded per the query-guard. A single account's task volume is small;
      // 1000 is a generous cap (counts are KPI-grade, not exact beyond it).
      const tasks = await prisma.task.findMany({
        where: { orgId: req.auth.orgId, accountId: companyId, deletedAt: null },
        include: { initiative: { select: { id: true, title: true, stage: true } } },
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
        take: 1000,
      });
      const openTasks = tasks.filter((t) => t.status !== 'done');
      const items = openTasks.map((t) => ({
        ...toTaskDetail(t),
        initiativeTitle: t.initiative?.title ?? '(unlinked)',
        initiativeStage: (t.initiative?.stage ?? 'initiative') as
          | 'initiative'
          | 'lead'
          | 'opportunity'
          | 'dropped',
      }));

      // Soft 1–3 hint: active initiatives (initiative|lead) with 0 open tasks
      // are stale; >3 are overloaded. Never hard-blocks creation.
      const activeInits = await prisma.kamInitiative.findMany({
        where: { orgId: req.auth.orgId, companyId, deletedAt: null, stage: { in: ['initiative', 'lead'] } },
        select: { id: true },
        take: 1000,
      });
      const openByInit = new Map<string, number>();
      for (const t of openTasks) {
        if (t.initiativeId) openByInit.set(t.initiativeId, (openByInit.get(t.initiativeId) ?? 0) + 1);
      }
      return {
        companyId,
        openCount: openTasks.length,
        doneCount: tasks.length - openTasks.length,
        items,
        staleInitiativeIds: activeInits.filter((i) => (openByInit.get(i.id) ?? 0) === 0).map((i) => i.id),
        overloadedInitiativeIds: activeInits.filter((i) => (openByInit.get(i.id) ?? 0) > 3).map((i) => i.id),
      };
    },
  );
};

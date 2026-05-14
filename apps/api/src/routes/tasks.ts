import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import { Task, TaskCreate, TaskPatch, TaskStatus } from '@bidstack/shared';

export const tasksRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/tasks',
    {
      schema: {
        querystring: z.object({
          oppId: z.string().uuid().optional(),
          status: TaskStatus.optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
        response: { 200: z.object({ items: z.array(Task) }) },
      },
    },
    async (req) => {
      const items = await prisma.task.findMany({
        where: {
          orgId: req.auth.orgId,
          ...(req.query.oppId ? { oppId: req.query.oppId } : {}),
          ...(req.query.status ? { status: req.query.status } : {}),
        },
        include: { assignee: true },
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
        take: req.query.limit,
      });
      return {
        items: items.map((t) => ({
          id: t.id,
          oppId: t.oppId,
          title: t.title,
          dueDate: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null,
          status: t.status,
          assignee: t.assignee?.email ?? null,
          createdAt: t.createdAt.toISOString(),
        })),
      };
    },
  );

  server.post(
    '/tasks',
    {
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
        where: { id: req.params.id, orgId: req.auth.orgId },
        select: { id: true },
      });
      if (!existing) throw server.httpErrors.notFound('Task not found');

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

      const updated = await prisma.task.update({
        where: { id: existing.id },
        data: {
          ...(req.body.title !== undefined ? { title: req.body.title } : {}),
          ...(req.body.dueDate !== undefined
            ? { dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null }
            : {}),
          ...(req.body.status !== undefined ? { status: req.body.status } : {}),
          ...(assigneeId !== undefined ? { assigneeId } : {}),
        },
        include: { assignee: true },
      });
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
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const existing = await prisma.task.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId },
        select: { id: true, title: true },
      });
      if (!existing) throw server.httpErrors.notFound('Task not found');

      await prisma.$transaction([
        prisma.task.delete({ where: { id: existing.id } }),
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
      return reply.code(204).send(null);
    },
  );
};

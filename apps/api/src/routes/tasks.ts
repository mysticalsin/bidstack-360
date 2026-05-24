import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma, Prisma } from '@bidstack/db';
import { Task, TaskCreate, TaskFilter, TaskPage, TaskPatch } from '@bidstack/shared';

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

      await prisma.$transaction([
        prisma.task.update({
          where: { id: existing.id },
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
      return reply.code(204).send(null);
    },
  );
};

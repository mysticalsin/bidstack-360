import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import { Task, TaskCreate, TaskStatus } from '@bidstack/shared';

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
      const created = await prisma.task.create({
        data: {
          orgId: req.auth.orgId,
          oppId: body.oppId,
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
};

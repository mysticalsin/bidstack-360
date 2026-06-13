// In-app notification center — list, unread count, mark-read. Per-user +
// org-scoped (a user only ever sees their own notifications).
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import { Notification, NotificationPage, type NotificationType } from '@bidstack/shared';

interface DbRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
  url: string | null;
  readAt: Date | null;
  createdAt: Date;
}

function serialize(r: DbRow): z.infer<typeof Notification> {
  return {
    id: r.id,
    type: r.type as NotificationType,
    title: r.title,
    body: r.body,
    entityType: r.entityType,
    entityId: r.entityId,
    url: r.url,
    readAt: r.readAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

const IdParam = z.object({ id: z.string().uuid() });

export const notificationsRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/notifications',
    {
      schema: {
        querystring: z.object({ unreadOnly: z.coerce.boolean().optional() }),
        response: { 200: NotificationPage },
      },
    },
    async (req) => {
      const where = {
        orgId: req.auth.orgId,
        userId: req.auth.userId,
        ...(req.query.unreadOnly ? { readAt: null } : {}),
      };
      const [items, unread] = await Promise.all([
        prisma.notification.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: 30,
        }),
        prisma.notification.count({
          where: { orgId: req.auth.orgId, userId: req.auth.userId, readAt: null },
        }),
      ]);
      return { items: items.map(serialize), unread };
    },
  );

  server.patch(
    '/notifications/:id/read',
    { schema: { params: IdParam, response: { 200: Notification } } },
    async (req) => {
      // updateMany keeps the write org+user scoped — a user can only mark their
      // own notification read.
      const result = await prisma.notification.updateMany({
        where: { id: req.params.id, orgId: req.auth.orgId, userId: req.auth.userId },
        data: { readAt: new Date() },
      });
      if (result.count === 0) throw server.httpErrors.notFound('Notification not found');
      const row = await prisma.notification.findFirstOrThrow({
        where: { id: req.params.id, orgId: req.auth.orgId, userId: req.auth.userId },
      });
      return serialize(row);
    },
  );

  server.post(
    '/notifications/read-all',
    { schema: { response: { 200: z.object({ updated: z.number().int().nonnegative() }) } } },
    async (req) => {
      const result = await prisma.notification.updateMany({
        where: { orgId: req.auth.orgId, userId: req.auth.userId, readAt: null },
        data: { readAt: new Date() },
      });
      return { updated: result.count };
    },
  );
};

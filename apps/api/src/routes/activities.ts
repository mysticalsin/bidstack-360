import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma, type Prisma } from '@bidstack/db';
import {
  Activity,
  ActivityCreate,
  ActivityPatch,
  ActivityFilter,
  ActivityList,
} from '@bidstack/shared';
import { normalizeTenantEntityType, tenantEntityBelongsToOrg } from '../lib/tenant-ownership.js';

function serializeActivity(row: {
  id: string;
  orgId: string;
  type: string;
  subject: string | null;
  description: string | null;
  startTime: Date | null;
  endTime: Date | null;
  status: string;
  entityType: string;
  entityId: string;
  ownerId: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): z.infer<typeof Activity> {
  return {
    id: row.id,
    orgId: row.orgId,
    type: row.type as z.infer<typeof Activity>['type'],
    subject: row.subject,
    description: row.description,
    startTime: row.startTime?.toISOString() ?? null,
    endTime: row.endTime?.toISOString() ?? null,
    status: row.status as z.infer<typeof Activity>['status'],
    entityType: row.entityType,
    entityId: row.entityId,
    ownerId: row.ownerId,
    metadata: row.metadata as Record<string, unknown> | null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const activityRoutes: FastifyPluginAsyncZod = async (server) => {
  // GET /api/v1/activities
  server.get(
    '/activities',
    {
      schema: {
        querystring: ActivityFilter,
        response: { 200: ActivityList },
      },
    },
    async (req) => {
      const { entityType, entityId, type, status, ownerId, limit, offset } = req.query;
      const where = {
        orgId: req.auth.orgId,
        deletedAt: null,
        ...(entityType ? { entityType } : {}),
        ...(entityId ? { entityId } : {}),
        ...(type ? { type } : {}),
        ...(status ? { status } : {}),
        ...(ownerId ? { ownerId } : {}),
      };
      const [items, total] = await Promise.all([
        prisma.activity.findMany({
          where,
          orderBy: { startTime: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.activity.count({ where }),
      ]);
      return { items: items.map(serializeActivity), total };
    },
  );

  // GET /api/v1/activities/:id
  server.get(
    '/activities/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: Activity },
      },
    },
    async (req, reply) => {
      const row = await prisma.activity.findFirst({
        where: { orgId: req.auth.orgId, id: req.params.id, deletedAt: null },
      });
      if (!row) return reply.notFound('Activity not found');
      return serializeActivity(row);
    },
  );

  // POST /api/v1/activities
  server.post(
    '/activities',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        body: ActivityCreate,
        response: { 201: Activity },
      },
    },
    async (req, reply) => {
      if (!normalizeTenantEntityType(req.body.entityType)) {
        throw server.httpErrors.badRequest(`Unsupported activity entity type: ${req.body.entityType}`);
      }
      if (
        !(await tenantEntityBelongsToOrg(
          req.body.entityType,
          req.body.entityId,
          req.auth.orgId,
        ))
      ) {
        return reply.notFound('Activity target not found');
      }
      if (
        req.body.ownerId &&
        !(await tenantEntityBelongsToOrg('user', req.body.ownerId, req.auth.orgId))
      ) {
        return reply.notFound('Activity owner not found');
      }

      const row = await prisma.activity.create({
        data: {
          orgId: req.auth.orgId,
          type: req.body.type,
          subject: req.body.subject ?? null,
          description: req.body.description ?? null,
          startTime: req.body.startTime ? new Date(req.body.startTime) : null,
          endTime: req.body.endTime ? new Date(req.body.endTime) : null,
          status: req.body.status ?? 'planned',
          entityType: req.body.entityType,
          entityId: req.body.entityId,
          ownerId: req.body.ownerId ?? req.auth.userId,
          metadata: (req.body.metadata ?? {}) as Prisma.JsonObject,
        },
      });
      reply.status(201);
      return serializeActivity(row);
    },
  );

  // PATCH /api/v1/activities/:id
  server.patch(
    '/activities/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: ActivityPatch,
        response: { 200: Activity },
      },
    },
    async (req, reply) => {
      const row = await prisma.activity.findFirst({
        where: { orgId: req.auth.orgId, id: req.params.id, deletedAt: null },
      });
      if (!row) return reply.notFound('Activity not found');

      const updated = await prisma.activity.update({
        where: { id: req.params.id },
        data: {
          ...(req.body.type !== undefined ? { type: req.body.type } : {}),
          ...(req.body.subject !== undefined ? { subject: req.body.subject } : {}),
          ...(req.body.description !== undefined ? { description: req.body.description } : {}),
          ...(req.body.startTime !== undefined
            ? { startTime: req.body.startTime ? new Date(req.body.startTime) : null }
            : {}),
          ...(req.body.endTime !== undefined
            ? { endTime: req.body.endTime ? new Date(req.body.endTime) : null }
            : {}),
          ...(req.body.status !== undefined ? { status: req.body.status } : {}),
          ...(req.body.metadata !== undefined
            ? { metadata: req.body.metadata as Prisma.JsonObject }
            : {}),
        },
      });
      return serializeActivity(updated);
    },
  );

  // DELETE /api/v1/activities/:id
  server.delete(
    '/activities/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const row = await prisma.activity.findFirst({
        where: { orgId: req.auth.orgId, id: req.params.id, deletedAt: null },
      });
      if (!row) return reply.notFound('Activity not found');
      await prisma.activity.update({
        where: { id: req.params.id },
        data: { deletedAt: new Date() },
      });
      reply.status(204);
      return null;
    },
  );
};

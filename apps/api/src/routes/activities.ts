// Activity routes — CRUD for activities plus entity-scoped timeline feed.
//
// WHY two surfaces:
//  - GET /activities (generic filter) — used by the cockpit recent feed
//  - GET /entities/:entityType/:entityId/activities — timeline for a specific entity,
//    cursor-paginated, uses the activity service for consistent business logic

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma, type Prisma } from '@bidstack/db';
import {
  Activity,
  ActivityCreate,
  ActivityPatch,
  ActivityFilter,
  ActivityList,
  TimelinePage,
} from '@bidstack/shared';
import { normalizeTenantEntityType, tenantEntityBelongsToOrg } from '../lib/tenant-ownership.js';
import { logActivity, getTimeline } from '../services/activity.service.js';
import type { ActivityEventType } from '../services/activity.service.js';

type ActivityRow = {
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
  actorId: string | null;
  actorType: string;
  body: unknown;
  occurredAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

function serializeActivity(row: ActivityRow): z.infer<typeof Activity> {
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
    actorId: row.actorId,
    actorType: (row.actorType ?? 'user') as 'user' | 'system' | 'agent',
    body: (row.body as Record<string, unknown>) ?? null,
    occurredAt: row.occurredAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const activityRoutes: FastifyPluginAsyncZod = async (server) => {

  // RBAC: gate every route in this plugin by method — writes need 'activities:write',
  // reads need 'activities:read'. Runs after the global auth onRequest.
  server.addHook('preHandler', async (req) => {
    const isWrite = req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE';
    await server.requirePermission(isWrite ? 'activities:write' : 'activities:read')(req);
  });
  // ── Entity-scoped timeline (cursor pagination) ──────────────────────────
  // GET /api/v1/entities/:entityType/:entityId/activities
  server.get(
    '/entities/:entityType/:entityId/activities',
    {
      schema: {
        params: z.object({
          entityType: z.string().min(1).max(50),
          entityId: z.string().uuid(),
        }),
        querystring: z.object({
          cursor: z.string().datetime().optional(),
          limit: z.coerce.number().int().min(1).max(100).optional().default(25),
          typeFilter: z
            .string()
            .optional()
            .transform((v) => (v ? (v.split(',') as ActivityEventType[]) : undefined)),
        }),
        response: { 200: TimelinePage },
      },
    },
    async (req, reply) => {
      const { entityType, entityId } = req.params;
      const { cursor, limit, typeFilter } = req.query;

      // Verify the entity belongs to this org (no cross-tenant reads)
      if (
        normalizeTenantEntityType(entityType) &&
        !(await tenantEntityBelongsToOrg(entityType, entityId, req.auth.orgId))
      ) {
        return reply.notFound('Entity not found');
      }

      const page = await getTimeline({
        orgId: req.auth.orgId,
        entityType,
        entityId,
        cursor,
        limit,
        typeFilter,
      });

      return page;
    },
  );

  // ── Generic activity filter feed ─────────────────────────────────────────
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
      const { entityType, entityId, type, status, ownerId, actorId, limit, offset, cursor } =
        req.query;

      const where: Prisma.ActivityWhereInput = {
        orgId: req.auth.orgId,
        deletedAt: null,
        ...(entityType ? { entityType } : {}),
        ...(entityId ? { entityId } : {}),
        ...(type ? { type } : {}),
        ...(status ? { status } : {}),
        ...(ownerId ? { ownerId } : {}),
        ...(actorId ? { actorId } : {}),
        ...(cursor ? { occurredAt: { lt: new Date(cursor) } } : {}),
      };

      const [items, total] = await Promise.all([
        prisma.activity.findMany({
          where,
          orderBy: { occurredAt: 'desc' },
          take: limit,
          skip: offset,
          // Narrow select matching ActivityRow exactly — serializeActivity's
          // param type below fails to compile if this list ever drops a field
          // the serializer needs, so it can't silently drift out of sync.
          select: {
            id: true,
            orgId: true,
            type: true,
            subject: true,
            description: true,
            startTime: true,
            endTime: true,
            status: true,
            entityType: true,
            entityId: true,
            ownerId: true,
            metadata: true,
            actorId: true,
            actorType: true,
            body: true,
            occurredAt: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        prisma.activity.count({ where }),
      ]);

      const serialized = items.map(serializeActivity);
      // Only advertise a next page when THIS page is full; a partial page is the
      // last page, so emitting a cursor there produced a phantom 'next' that
      // fetched 0 rows.
      const nextCursor =
        items.length === limit ? items[items.length - 1]?.occurredAt.toISOString() ?? null : null;

      return { items: serialized, total, nextCursor };
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
      return serializeActivity(row as ActivityRow);
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
        throw server.httpErrors.badRequest(
          `Unsupported activity entity type: ${req.body.entityType}`,
        );
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

      const item = await logActivity({
        orgId: req.auth.orgId,
        entityType: req.body.entityType as ActivityEventType extends string ? never : string,
        entityId: req.body.entityId,
        type: req.body.type as ActivityEventType,
        actorId: req.body.actorId ?? req.auth.userId,
        actorType: (req.body.actorType as 'user' | 'system' | 'agent') ?? 'user',
        subject: req.body.subject,
        description: req.body.description,
        startTime: req.body.startTime ? new Date(req.body.startTime) : null,
        endTime: req.body.endTime ? new Date(req.body.endTime) : null,
        status: req.body.status ?? 'planned',
        metadata: req.body.metadata,
        body: req.body.body,
        occurredAt: req.body.occurredAt ? new Date(req.body.occurredAt) : new Date(),
        idempotencyKey: req.body.idempotencyKey,
      });

      // Re-fetch the full row to satisfy the Activity schema (startTime, endTime, etc.)
      // Scope by orgId too (convention) — the row was just created in this org.
      const row = await prisma.activity.findFirstOrThrow({
        where: { id: item.id, orgId: req.auth.orgId },
      });
      reply.status(201);
      return serializeActivity(row as ActivityRow);
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
          ...(req.body.body !== undefined ? { body: req.body.body as Prisma.JsonObject } : {}),
        },
      });
      return serializeActivity(updated as ActivityRow);
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

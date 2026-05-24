/**
 * Calendar event routes — authenticated CRUD with two-way sync.
 *
 * Create/update/delete enqueues a calendar.push job so changes propagate to
 * Google Calendar or MS Graph asynchronously via the worker.
 *
 * Multi-tenancy: all queries include orgId from req.auth — never from the client.
 */

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@bidstack/db';
import { CALENDAR_PUSH } from '@bidstack/shared';
import { Queue } from 'bullmq';

const CalendarEventCreate = z.object({
  subject: z.string().min(1).max(300),
  bodyPreview: z.string().max(2000).optional(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  location: z.string().max(300).optional(),
  isAllDay: z.boolean().default(false),
  attendees: z
    .array(z.object({ email: z.string().email(), displayName: z.string().optional() }))
    .default([]),
  /** Which provider calendar to push to. Defaults to the user's primary integration. */
  provider: z.enum(['google_workspace', 'microsoft_graph']).optional(),
});

const CalendarEventPatch = CalendarEventCreate.partial();

const CalendarEventResponse = z.object({
  id: z.string().uuid(),
  subject: z.string(),
  startAt: z.string(),
  endAt: z.string(),
  location: z.string().nullable(),
  isAllDay: z.boolean(),
  syncState: z.string(),
  provider: z.string(),
  createdAt: z.string(),
});

export const calendarRoutes: FastifyPluginAsyncZod = async (server) => {
  function getPushQueue(): Queue {
    const redis = server.redis as InstanceType<typeof import('ioredis').default>;
    return new Queue(CALENDAR_PUSH.name, {
      connection: redis,
      defaultJobOptions: CALENDAR_PUSH.defaultJobOptions,
    });
  }

  // ── GET /calendar/events ───────────────────────────────────────────────
  server.get(
    '/calendar/events',
    {
      schema: {
        querystring: z.object({
          from: z.string().datetime().optional(),
          to: z.string().datetime().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(100),
        }),
        response: {
          200: z.object({ items: z.array(CalendarEventResponse) }),
        },
      },
    },
    async (req) => {
      const { from, to, limit } = req.query;

      const items = await prisma.calendarEvent.findMany({
        where: {
          orgId: req.auth.orgId,
          ownerId: req.auth.userId,
          deletedAt: null,
          syncState: { not: 'DELETED_REMOTE' },
          ...(from ? { startAt: { gte: new Date(from) } } : {}),
          ...(to ? { endAt: { lte: new Date(to) } } : {}),
        },
        orderBy: { startAt: 'asc' },
        take: limit,
        select: {
          id: true,
          subject: true,
          startAt: true,
          endAt: true,
          location: true,
          isAllDay: true,
          syncState: true,
          provider: true,
          createdAt: true,
        },
      });

      return {
        items: items.map((e) => ({
          id: e.id,
          subject: e.subject,
          startAt: e.startAt.toISOString(),
          endAt: e.endAt.toISOString(),
          location: e.location,
          isAllDay: e.isAllDay,
          syncState: e.syncState,
          provider: e.provider,
          createdAt: e.createdAt.toISOString(),
        })),
      };
    },
  );

  // ── POST /calendar/events ─────────────────────────────────────────────
  server.post(
    '/calendar/events',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        body: CalendarEventCreate,
        response: { 201: CalendarEventResponse },
      },
    },
    async (req, reply) => {
      const { orgId, userId } = req.auth;

      // Resolve which provider to use (default to the first active integration)
      let provider = req.body.provider;
      if (!provider) {
        const token = await prisma.integrationToken.findFirst({
          where: { orgId, userId, status: 'active', deletedAt: null },
          select: { provider: true },
          orderBy: { createdAt: 'asc' },
        });
        provider = token?.provider ?? 'google_workspace';
      }

      const event = await prisma.calendarEvent.create({
        data: {
          orgId,
          ownerId: userId,
          externalId: null,
          provider,
          subject: req.body.subject,
          bodyPreview: req.body.bodyPreview ?? null,
          startAt: new Date(req.body.startAt),
          endAt: new Date(req.body.endAt),
          location: req.body.location ?? null,
          isAllDay: req.body.isAllDay,
          isCancelled: false,
          attendees: req.body.attendees,
          syncState: 'PENDING_PUSH',
        },
        select: {
          id: true, subject: true, startAt: true, endAt: true, location: true,
          isAllDay: true, syncState: true, provider: true, createdAt: true,
        },
      });

      // Enqueue push — don't fail the request if the queue is temporarily unavailable
      try {
        const queue = getPushQueue();
        await queue.add('calendar.push', {
          orgId,
          userId,
          calendarEventId: event.id,
          operation: 'push',
        });
      } catch (err) {
        server.log.warn({ err, eventId: event.id }, 'Push queue unavailable; event will be re-picked on next sync');
      }

      return reply.code(201).send({
        id: event.id,
        subject: event.subject,
        startAt: event.startAt.toISOString(),
        endAt: event.endAt.toISOString(),
        location: event.location,
        isAllDay: event.isAllDay,
        syncState: event.syncState,
        provider: event.provider,
        createdAt: event.createdAt.toISOString(),
      });
    },
  );

  // ── PATCH /calendar/events/:id ────────────────────────────────────────
  server.patch(
    '/calendar/events/:id',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: CalendarEventPatch,
        response: { 200: CalendarEventResponse },
      },
    },
    async (req, reply) => {
      const { orgId, userId } = req.auth;

      const existing = await prisma.calendarEvent.findFirst({
        where: { id: req.params.id, orgId, ownerId: userId, deletedAt: null },
        select: { id: true, syncState: true },
      });
      if (!existing) throw server.httpErrors.notFound('Calendar event not found');

      // Don't allow edits on conflicted events until user resolves them
      if (existing.syncState === 'CONFLICT') {
        throw server.httpErrors.conflict(
          'This event has a sync conflict with the provider. Resolve the conflict before editing.',
        );
      }

      const event = await prisma.calendarEvent.update({
        where: { id: req.params.id },
        data: {
          ...(req.body.subject !== undefined ? { subject: req.body.subject } : {}),
          ...(req.body.bodyPreview !== undefined ? { bodyPreview: req.body.bodyPreview } : {}),
          ...(req.body.startAt !== undefined ? { startAt: new Date(req.body.startAt) } : {}),
          ...(req.body.endAt !== undefined ? { endAt: new Date(req.body.endAt) } : {}),
          ...(req.body.location !== undefined ? { location: req.body.location } : {}),
          ...(req.body.isAllDay !== undefined ? { isAllDay: req.body.isAllDay } : {}),
          ...(req.body.attendees !== undefined ? { attendees: req.body.attendees } : {}),
          syncState: 'PENDING_PUSH',
        },
        select: {
          id: true, subject: true, startAt: true, endAt: true, location: true,
          isAllDay: true, syncState: true, provider: true, createdAt: true,
        },
      });

      try {
        const queue = getPushQueue();
        await queue.add('calendar.push', {
          orgId,
          userId,
          calendarEventId: event.id,
          operation: 'update',
        });
      } catch (err) {
        server.log.warn({ err, eventId: event.id }, 'Push queue unavailable on update');
      }

      return reply.send({
        id: event.id,
        subject: event.subject,
        startAt: event.startAt.toISOString(),
        endAt: event.endAt.toISOString(),
        location: event.location,
        isAllDay: event.isAllDay,
        syncState: event.syncState,
        provider: event.provider,
        createdAt: event.createdAt.toISOString(),
      });
    },
  );

  // ── DELETE /calendar/events/:id ───────────────────────────────────────
  server.delete(
    '/calendar/events/:id',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const { orgId, userId } = req.auth;

      const event = await prisma.calendarEvent.findFirst({
        where: { id: req.params.id, orgId, ownerId: userId, deletedAt: null },
        select: { id: true, externalId: true },
      });
      if (!event) throw server.httpErrors.notFound('Calendar event not found');

      // Soft-delete locally
      await prisma.calendarEvent.update({
        where: { id: event.id },
        data: { syncState: 'PENDING_PUSH', deletedAt: new Date() },
      });

      // Enqueue delete on provider side
      if (event.externalId) {
        try {
          const queue = getPushQueue();
          await queue.add('calendar.push', {
            orgId,
            userId,
            calendarEventId: event.id,
            operation: 'delete',
          });
        } catch (err) {
          server.log.warn({ err, eventId: event.id }, 'Push queue unavailable on delete');
        }
      }

      return reply.code(204).send(null);
    },
  );
};

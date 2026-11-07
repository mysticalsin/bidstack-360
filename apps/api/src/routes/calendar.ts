/**
 * Calendar event routes — authenticated CRUD with optional two-way sync.
 *
 * Create/update/delete enqueues a calendar.push job only when the user's
 * grant includes calendar write access. Connect grants read-only scopes by
 * default, so most events created here stay in Polo (localOnly).
 *
 * Multi-tenancy: all queries include orgId from req.auth — never from the client.
 */

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@bidstack/db';
import { CALENDAR_PUSH, grantsCalendarWrite } from '@bidstack/shared';
import { Queue } from 'bullmq';
import { redis } from '../redis.js';

const CalendarEventBase = z.object({
  subject: z.string().min(1).max(300),
  bodyPreview: z.string().max(2000).optional(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  location: z.string().max(300).optional(),
  isAllDay: z.boolean().default(false),
  attendees: z
    .array(z.object({ email: z.string().email(), displayName: z.string().max(200).optional() }))
    .max(200)
    .default([]),
  /** Which provider calendar to push to. Defaults to the user's primary integration. */
  provider: z.enum(['google_workspace', 'microsoft_graph']).optional(),
  contactId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  opportunityId: z.string().uuid().optional(),
  /** Retry key: a repeated create with the same id returns the first event. */
  clientRequestId: z.string().min(8).max(64).optional(),
});

const endsAfterStart = (v: { startAt?: string; endAt?: string }) =>
  !v.startAt || !v.endAt || new Date(v.endAt).getTime() >= new Date(v.startAt).getTime();
const END_BEFORE_START = { message: 'endAt must not be before startAt', path: ['endAt'] };

const CalendarEventCreate = CalendarEventBase.refine(endsAfterStart, END_BEFORE_START);
const CalendarEventPatch = CalendarEventBase.omit({ clientRequestId: true, provider: true })
  .partial()
  .refine(endsAfterStart, END_BEFORE_START);

type CalendarProvider = 'google_workspace' | 'microsoft_graph';

const CalendarEventResponse = z.object({
  id: z.string().uuid(),
  subject: z.string(),
  startAt: z.string(),
  endAt: z.string(),
  location: z.string().nullable(),
  isAllDay: z.boolean(),
  syncState: z.string(),
  provider: z.string(),
  contactId: z.string().uuid().nullable(),
  companyId: z.string().uuid().nullable(),
  opportunityId: z.string().uuid().nullable(),
  /** Created in Polo and not pushed to a provider calendar. */
  localOnly: z.boolean(),
  createdAt: z.string(),
});

const EVENT_SELECT = {
  id: true,
  subject: true,
  startAt: true,
  endAt: true,
  location: true,
  isAllDay: true,
  syncState: true,
  provider: true,
  externalId: true,
  contactId: true,
  companyId: true,
  opportunityId: true,
  createdAt: true,
} as const;

type EventRow = {
  id: string;
  subject: string;
  startAt: Date;
  endAt: Date;
  location: string | null;
  isAllDay: boolean;
  syncState: string;
  provider: string;
  externalId: string | null;
  contactId: string | null;
  companyId: string | null;
  opportunityId: string | null;
  createdAt: Date;
};

function toResponse(e: EventRow): z.infer<typeof CalendarEventResponse> {
  return {
    id: e.id,
    subject: e.subject,
    startAt: e.startAt.toISOString(),
    endAt: e.endAt.toISOString(),
    location: e.location,
    isAllDay: e.isAllDay,
    syncState: e.syncState,
    provider: e.provider,
    contactId: e.contactId,
    companyId: e.companyId,
    opportunityId: e.opportunityId,
    localOnly: e.externalId === null && e.syncState === 'SYNCED',
    createdAt: e.createdAt.toISOString(),
  };
}

/**
 * The user's calendar grant. Google grants live on the `gmail` row (one consent
 * for mail and calendar); older `google_workspace` rows still count.
 */
async function findCalendarGrant(
  orgId: string,
  userId: string,
  preferred?: CalendarProvider,
): Promise<{ provider: CalendarProvider; canWrite: boolean } | null> {
  const rows = await prisma.integrationToken.findMany({
    where: {
      orgId,
      userId,
      status: 'active',
      deletedAt: null,
      provider: { in: ['google_workspace', 'gmail', 'microsoft_graph'] },
    },
    select: { provider: true, scope: true },
    orderBy: { createdAt: 'asc' },
    take: 5,
  });
  const grants = rows.map((r) => ({
    provider: (r.provider === 'microsoft_graph' ? 'microsoft_graph' : 'google_workspace') as CalendarProvider,
    canWrite: grantsCalendarWrite(r.scope),
  }));
  const pool = preferred ? grants.filter((g) => g.provider === preferred) : grants;
  return pool.find((g) => g.canWrite) ?? pool[0] ?? null;
}

export const calendarRoutes: FastifyPluginAsyncZod = async (server) => {
  let pushQueue: Queue | null = null;
  function getPushQueue(): Queue {
    pushQueue ??= new Queue(CALENDAR_PUSH.name, {
      connection: redis,
      defaultJobOptions: CALENDAR_PUSH.defaultJobOptions,
    });
    return pushQueue;
  }
  server.addHook('onClose', async () => {
    await pushQueue?.close();
  });

  async function enqueuePush(
    data: { orgId: string; userId: string; calendarEventId: string; operation: 'push' | 'update' | 'delete' },
  ): Promise<void> {
    try {
      await getPushQueue().add('calendar.push', data);
    } catch (err) {
      server.log.warn({ err, eventId: data.calendarEventId }, 'Push queue unavailable; event will be re-picked on next sync');
    }
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
          isCancelled: false,
          syncState: { not: 'DELETED_REMOTE' },
          // Overlap predicate, not containment — an event that starts before
          // `from` or ends after `to` still belongs on screen for that range
          // (multi-day events, week-boundary meetings).
          ...(to ? { startAt: { lt: new Date(to) } } : {}),
          ...(from ? { endAt: { gt: new Date(from) } } : {}),
        },
        orderBy: { startAt: 'asc' },
        take: limit,
        select: EVENT_SELECT,
      });

      return { items: items.map(toResponse) };
    },
  );

  // ── POST /calendar/events ─────────────────────────────────────────────
  server.post(
    '/calendar/events',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        body: CalendarEventCreate,
        response: { 200: CalendarEventResponse, 201: CalendarEventResponse },
      },
    },
    async (req, reply) => {
      const { orgId, userId } = req.auth;
      const { clientRequestId } = req.body;

      if (clientRequestId) {
        const existing = await prisma.calendarEvent.findFirst({
          where: { orgId, ownerId: userId, clientRequestId },
          select: EVENT_SELECT,
        });
        if (existing) return reply.code(200).send(toResponse(existing));
      }

      const grant = await findCalendarGrant(orgId, userId, req.body.provider);
      const provider: CalendarProvider = grant?.provider ?? req.body.provider ?? 'google_workspace';
      const push = grant?.canWrite === true;

      let event: EventRow;
      try {
        event = await prisma.calendarEvent.create({
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
            contactId: req.body.contactId ?? null,
            companyId: req.body.companyId ?? null,
            opportunityId: req.body.opportunityId ?? null,
            clientRequestId: clientRequestId ?? null,
            syncState: push ? 'PENDING_PUSH' : 'SYNCED',
          },
          select: EVENT_SELECT,
        });
      } catch (err) {
        if ((err as { code?: string }).code !== 'P2002' || !clientRequestId) throw err;
        const raced = await prisma.calendarEvent.findFirst({
          where: { orgId, ownerId: userId, clientRequestId },
          select: EVENT_SELECT,
        });
        if (!raced) throw err;
        return reply.code(200).send(toResponse(raced));
      }

      if (push) await enqueuePush({ orgId, userId, calendarEventId: event.id, operation: 'push' });
      return reply.code(201).send(toResponse(event));
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
        select: { id: true, syncState: true, startAt: true, endAt: true, externalId: true, provider: true },
      });
      if (!existing) throw server.httpErrors.notFound('Calendar event not found');

      // Don't allow edits on conflicted events until user resolves them
      if (existing.syncState === 'CONFLICT') {
        throw server.httpErrors.conflict(
          'This event has a sync conflict with the provider. Resolve the conflict before editing.',
        );
      }

      const startAt = req.body.startAt ? new Date(req.body.startAt) : existing.startAt;
      const endAt = req.body.endAt ? new Date(req.body.endAt) : existing.endAt;
      if (endAt.getTime() < startAt.getTime()) {
        throw server.httpErrors.badRequest('endAt must not be before startAt');
      }

      const grant = await findCalendarGrant(orgId, userId, existing.provider as CalendarProvider);
      const push = grant?.canWrite === true;

      const event = await prisma.calendarEvent.update({
        where: { id: existing.id },
        data: {
          ...(req.body.subject !== undefined ? { subject: req.body.subject } : {}),
          ...(req.body.bodyPreview !== undefined ? { bodyPreview: req.body.bodyPreview } : {}),
          ...(req.body.startAt !== undefined ? { startAt } : {}),
          ...(req.body.endAt !== undefined ? { endAt } : {}),
          ...(req.body.location !== undefined ? { location: req.body.location } : {}),
          ...(req.body.isAllDay !== undefined ? { isAllDay: req.body.isAllDay } : {}),
          ...(req.body.attendees !== undefined ? { attendees: req.body.attendees } : {}),
          ...(req.body.contactId !== undefined ? { contactId: req.body.contactId } : {}),
          ...(req.body.companyId !== undefined ? { companyId: req.body.companyId } : {}),
          ...(req.body.opportunityId !== undefined ? { opportunityId: req.body.opportunityId } : {}),
          syncState: push ? 'PENDING_PUSH' : 'SYNCED',
        },
        select: EVENT_SELECT,
      });

      if (push) {
        await enqueuePush({
          orgId,
          userId,
          calendarEventId: event.id,
          operation: existing.externalId ? 'update' : 'push',
        });
      }

      return reply.send(toResponse(event));
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
        select: { id: true, externalId: true, provider: true },
      });
      if (!event) throw server.httpErrors.notFound('Calendar event not found');

      const grant = event.externalId
        ? await findCalendarGrant(orgId, userId, event.provider as CalendarProvider)
        : null;
      const push = grant?.canWrite === true;

      // Soft-delete locally. Read-only grants leave the provider copy alone.
      await prisma.calendarEvent.update({
        where: { id: event.id },
        data: { syncState: push ? 'PENDING_PUSH' : 'SYNCED', deletedAt: new Date() },
      });

      if (push) await enqueuePush({ orgId, userId, calendarEventId: event.id, operation: 'delete' });

      return reply.code(204).send(null);
    },
  );
};

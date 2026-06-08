// Public booking routes — no auth required.
//
// Security:
//   - Public endpoints are scoped exclusively by slug → page → orgId.
//     Client-supplied orgId is never trusted on public endpoints.
//   - Availability: 60 req/min per IP. Booking create: 5 req/hour per IP.
//   - cancelToken is a UUID issued at booking creation. It is never returned
//     by authenticated list endpoints — only in the confirmation email.
//
// Endpoints:
//   GET  /booking-pages/:slug/availability — available time slots for a day
//   POST /booking-pages/:slug/bookings     — create a booking (public)
//   GET  /bookings/:id/cancel              — cancel by token (public)
//
// Authenticated page management → bookings-pages.ts
// Schemas + email helper        → bookings.helpers.ts

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma, type Prisma } from '@bidstack/db';
import { Queue } from 'bullmq';
import {
  computeSlots,
  type AvailabilityRule,
  type BlockingEvent,
  CALENDAR_PUSH,
} from '@bidstack/shared';
import { redis } from '../redis.js';
import { PublicBookingCreate, sendBookingConfirmationEmail } from './bookings.helpers.js';

const BOOKING_BLOCKING_LOOKUP_LIMIT = 1000;
const bookingCreateRateLimitMax = Number(process.env.PUBLIC_BOOKING_RATE_LIMIT_MAX ?? 5);

function dateKeyInTz(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const year = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

function getPushQueue(): Queue {
  return new Queue(CALENDAR_PUSH.name, {
    connection: redis,
    defaultJobOptions: CALENDAR_PUSH.defaultJobOptions,
  });
}

export const bookingsPublicRoutes: FastifyPluginAsyncZod = async (server) => {
  // ── GET /booking-pages/:slug/availability (PUBLIC) ────────────────────
  server.get(
    '/booking-pages/:slug/availability',
    {
      config: {
        public: true,
        rateLimit: { max: 60, timeWindow: '1 minute' },
      },
      schema: {
        params: z.object({ slug: z.string().min(1).max(60) }),
        querystring: z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
          tz: z.string().max(50).default('UTC'),
        }),
        response: {
          200: z.object({
            slots: z.array(z.string()),
            durationMinutes: z.number(),
            name: z.string(),
            description: z.string().nullable(),
            customQuestions: z.array(z.unknown()),
          }),
        },
      },
    },
    async (req, reply) => {
      const { slug } = req.params;
      const { date, tz } = req.query;

      const page = await prisma.bookingPage.findFirst({
        where: { slug, isActive: true, deletedAt: null },
        include: { user: { select: { id: true, orgId: true } } },
      });
      if (!page) throw server.httpErrors.notFound('Booking page not found');

      const rangeStart = new Date(`${date}T12:00:00Z`);
      const rangeEnd = new Date(`${date}T23:59:59Z`);

      const maxDate = new Date();
      maxDate.setDate(maxDate.getDate() + page.maxAdvanceDays);
      if (rangeStart > maxDate) {
        return reply.send({
          slots: [],
          durationMinutes: page.durationMinutes,
          name: page.name,
          description: page.description,
          customQuestions: page.customQuestions as unknown[],
        });
      }

      const bufferMs = Math.max(page.bufferBeforeMinutes, page.bufferAfterMinutes) * 60 * 1000;
      const fetchStart = new Date(rangeStart.getTime() - bufferMs);
      const fetchEnd = new Date(rangeEnd.getTime() + bufferMs);

      const existingEvents = await prisma.calendarEvent.findMany({
        where: {
          orgId: page.user.orgId,
          ownerId: page.userId,
          deletedAt: null,
          isCancelled: false,
          syncState: { not: 'DELETED_REMOTE' },
          startAt: { lte: fetchEnd },
          endAt: { gte: fetchStart },
        },
        orderBy: { startAt: 'asc' },
        take: BOOKING_BLOCKING_LOOKUP_LIMIT,
        select: { startAt: true, endAt: true, isAllDay: true },
      });

      const confirmedBookings = await prisma.booking.findMany({
        where: {
          bookingPageId: page.id,
          status: 'CONFIRMED',
          deletedAt: null,
          startAt: { lte: fetchEnd },
          endAt: { gte: fetchStart },
        },
        orderBy: { startAt: 'asc' },
        take: BOOKING_BLOCKING_LOOKUP_LIMIT,
        select: { startAt: true, endAt: true },
      });

      const allBlocking: BlockingEvent[] = [
        ...existingEvents.map((e) => ({
          startAt: e.startAt,
          endAt: e.endAt,
          isAllDay: e.isAllDay,
        })),
        ...confirmedBookings.map((b) => ({
          startAt: b.startAt,
          endAt: b.endAt,
          isAllDay: false,
        })),
      ];

      const slots = computeSlots({
        rules: page.availabilityRules as unknown as AvailabilityRule[],
        existingEvents: allBlocking,
        rangeStart,
        rangeEnd,
        durationMinutes: page.durationMinutes,
        bufferBeforeMinutes: page.bufferBeforeMinutes,
        bufferAfterMinutes: page.bufferAfterMinutes,
        tz,
        minNoticeHours: page.minNoticeHours,
      });

      return reply.send({
        slots,
        durationMinutes: page.durationMinutes,
        name: page.name,
        description: page.description,
        customQuestions: page.customQuestions as unknown[],
      });
    },
  );

  // ── POST /booking-pages/:slug/bookings (PUBLIC) ───────────────────────
  // Aggressive rate limit: 5 per IP per hour
  server.post(
    '/booking-pages/:slug/bookings',
    {
      config: {
        public: true,
        rateLimit: {
          max: Number.isFinite(bookingCreateRateLimitMax) ? bookingCreateRateLimitMax : 5,
          timeWindow: '1 hour',
          keyGenerator: (req) => req.ip,
        },
      },
      schema: {
        params: z.object({ slug: z.string().min(1).max(60) }),
        body: PublicBookingCreate,
        response: {
          201: z.object({
            bookingId: z.string().uuid(),
            startAt: z.string(),
            endAt: z.string(),
            /** Public cancel URL token (must be sent in confirmation email) */
            cancelToken: z.string().uuid(),
          }),
        },
      },
    },
    async (req, reply) => {
      const { slug } = req.params;
      const {
        attendeeName,
        attendeeEmail,
        attendeePhone,
        startAt: startAtRaw,
        answers,
        tz,
      } = req.body;

      const page = await prisma.bookingPage.findFirst({
        where: { slug, isActive: true, deletedAt: null },
        include: { user: { select: { id: true, orgId: true, email: true, name: true } } },
      });
      if (!page) throw server.httpErrors.notFound('Booking page not found');

      const startAt = new Date(startAtRaw);
      const endAt = new Date(startAt.getTime() + page.durationMinutes * 60_000);

      const dayStr = dateKeyInTz(startAt, tz);
      const rangeStart = new Date(`${dayStr}T12:00:00Z`);
      const rangeEnd = new Date(`${dayStr}T23:59:59Z`);

      const blockingEvents = await prisma.calendarEvent.findMany({
        where: {
          orgId: page.user.orgId,
          ownerId: page.userId,
          deletedAt: null,
          isCancelled: false,
          syncState: { not: 'DELETED_REMOTE' },
          startAt: { lte: endAt },
          endAt: { gte: startAt },
        },
        orderBy: { startAt: 'asc' },
        take: BOOKING_BLOCKING_LOOKUP_LIMIT,
        select: { startAt: true, endAt: true, isAllDay: true },
      });

      const existingBookings = await prisma.booking.findMany({
        where: {
          bookingPageId: page.id,
          status: 'CONFIRMED',
          deletedAt: null,
          startAt: { lte: endAt },
          endAt: { gte: startAt },
        },
        orderBy: { startAt: 'asc' },
        take: BOOKING_BLOCKING_LOOKUP_LIMIT,
        select: { startAt: true, endAt: true },
      });

      const allBlocking: BlockingEvent[] = [
        ...blockingEvents.map((e) => ({
          startAt: e.startAt,
          endAt: e.endAt,
          isAllDay: e.isAllDay,
        })),
        ...existingBookings.map((b) => ({ startAt: b.startAt, endAt: b.endAt, isAllDay: false })),
      ];

      const availableSlots = computeSlots({
        rules: page.availabilityRules as unknown as AvailabilityRule[],
        existingEvents: allBlocking,
        rangeStart,
        rangeEnd,
        durationMinutes: page.durationMinutes,
        bufferBeforeMinutes: page.bufferBeforeMinutes,
        bufferAfterMinutes: page.bufferAfterMinutes,
        tz,
        minNoticeHours: page.minNoticeHours,
      });

      const slotIso = startAt.toISOString();
      if (!availableSlots.includes(slotIso)) {
        throw server.httpErrors.conflict('The requested time slot is no longer available');
      }

      const booking = await prisma.booking.create({
        data: {
          orgId: page.user.orgId,
          bookingPageId: page.id,
          attendeeName,
          attendeeEmail,
          attendeePhone: attendeePhone ?? null,
          startAt,
          endAt,
          answers: (answers ?? {}) as Prisma.InputJsonValue,
          status: 'CONFIRMED',
        },
        select: { id: true, startAt: true, endAt: true, cancelToken: true },
      });

      const calEvent = await prisma.calendarEvent.create({
        data: {
          orgId: page.user.orgId,
          ownerId: page.userId,
          externalId: null,
          provider: 'google_workspace',
          subject: `${page.name} with ${attendeeName}`,
          bodyPreview: `Booked via ${page.name}. Attendee: ${attendeeEmail}`,
          startAt,
          endAt,
          isAllDay: false,
          isCancelled: false,
          attendees: [{ email: attendeeEmail, displayName: attendeeName }],
          organizerEmail: page.user.email,
          syncState: 'PENDING_PUSH',
        },
        select: { id: true },
      });

      await prisma.booking.update({
        where: { id: booking.id },
        data: { calendarEventId: calEvent.id },
      });

      try {
        const pushQueue = getPushQueue();
        await pushQueue.add('calendar.push', {
          orgId: page.user.orgId,
          userId: page.userId,
          calendarEventId: calEvent.id,
          operation: 'push',
        });
      } catch (err) {
        server.log.warn({ err, bookingId: booking.id }, 'Failed to enqueue calendar push');
      }

      // WHY fire-and-forget: cancelToken must reach the attendee; email failure
      // must never block the booking creation response.
      void sendBookingConfirmationEmail(
        {
          orgId: page.user.orgId,
          userId: page.userId,
          attendeeName,
          attendeeEmail,
          ownerName: page.user.name ?? null,
          pageName: page.name,
          startAt: booking.startAt,
          endAt: booking.endAt,
          bookingId: booking.id,
          cancelToken: booking.cancelToken,
        },
        server.log,
      );

      return reply.code(201).send({
        bookingId: booking.id,
        startAt: booking.startAt.toISOString(),
        endAt: booking.endAt.toISOString(),
        cancelToken: booking.cancelToken,
      });
    },
  );

  // ── GET /bookings/:id/cancel (PUBLIC) ─────────────────────────────────
  server.get(
    '/bookings/:id/cancel',
    {
      config: {
        public: true,
        rateLimit: { max: 20, timeWindow: '1 hour' },
      },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        querystring: z.object({ token: z.string().uuid() }),
        response: {
          200: z.object({ cancelled: z.boolean(), message: z.string() }),
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params;
      const { token } = req.query;

      // Validate by both id AND cancelToken — prevents enumeration attacks
      const booking = await prisma.booking.findFirst({
        where: { id, cancelToken: token, deletedAt: null },
        select: {
          id: true,
          status: true,
          calendarEventId: true,
          bookingPage: { select: { userId: true, user: { select: { orgId: true } } } },
        },
      });

      if (!booking) throw server.httpErrors.notFound('Booking not found or token invalid');
      if (booking.status === 'CANCELLED') {
        return reply.send({ cancelled: false, message: 'Booking is already cancelled' });
      }

      await prisma.booking.update({
        where: { id: booking.id },
        data: { status: 'CANCELLED' },
      });

      if (booking.calendarEventId) {
        try {
          const pushQueue = getPushQueue();
          await pushQueue.add('calendar.push', {
            orgId: booking.bookingPage.user.orgId,
            userId: booking.bookingPage.userId,
            calendarEventId: booking.calendarEventId,
            operation: 'delete',
          });
        } catch (err) {
          server.log.warn(
            { err, bookingId: booking.id },
            'Failed to enqueue calendar delete on cancel',
          );
        }
      }

      return reply.send({ cancelled: true, message: 'Your booking has been cancelled' });
    },
  );
};

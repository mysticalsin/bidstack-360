/**
 * Booking page routes — both authenticated (owner management) and public (attendee booking).
 *
 * Security notes:
 *   - Public availability + booking endpoints are scoped exclusively by slug → page → orgId.
 *     Client-supplied orgId is never trusted on public endpoints.
 *   - Public endpoints are rate-limited aggressively (5 per IP per hour for booking creation).
 *   - cancelToken is a UUID issued at booking creation. It is never returned by
 *     authenticated list endpoints — only in the confirmation email. Cancellation
 *     is performed by token only (no auth required, no org required).
 *   - No user data in logs from public endpoints.
 */

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type pino from 'pino';
import { z } from 'zod';
import { prisma, type Prisma } from '@bidstack/db';
import { computeSlots, type AvailabilityRule, type BlockingEvent } from '@bidstack/shared';
import { CALENDAR_PUSH } from '@bidstack/shared';
import { Queue } from 'bullmq';
import { redis } from '../redis.js';
import { sendEmail } from '../services/email-integration.service.js';

// ─── Zod schemas ──────────────────────────────────────────────────────────

const AvailabilityRuleSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:mm'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:mm'),
});

const CustomQuestionSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(['text', 'select', 'phone']),
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(),
});

const BookingPageCreate = z.object({
  slug: z
    .string()
    .min(3)
    .max(60)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  durationMinutes: z.number().int().min(15).max(480).default(30),
  bufferBeforeMinutes: z.number().int().min(0).max(60).default(0),
  bufferAfterMinutes: z.number().int().min(0).max(60).default(0),
  minNoticeHours: z.number().int().min(0).max(72).default(2),
  maxAdvanceDays: z.number().int().min(1).max(365).default(60),
  availabilityRules: z.array(AvailabilityRuleSchema).default([]),
  isActive: z.boolean().default(true),
  customQuestions: z.array(CustomQuestionSchema).default([]),
  redirectUrl: z.string().url().optional(),
});

const BookingPagePatch = BookingPageCreate.partial();

const PublicBookingCreate = z.object({
  attendeeName: z.string().min(1).max(120),
  attendeeEmail: z.string().email().max(254),
  attendeePhone: z.string().max(30).optional(),
  startAt: z.string().datetime(),
  /** Answers keyed by customQuestion.id */
  answers: z.record(z.unknown()).default({}),
  /** Optional IANA timezone for display in confirmation (not used for booking logic) */
  tz: z.string().max(50).default('UTC'),
});

// ─── Route plugin ─────────────────────────────────────────────────────────

export const bookingsRoutes: FastifyPluginAsyncZod = async (server) => {
  // Lazily obtain the push queue — avoids importing Redis at module level
  function getPushQueue(): Queue {
    return new Queue(CALENDAR_PUSH.name, {
      connection: redis,
      defaultJobOptions: CALENDAR_PUSH.defaultJobOptions,
    });
  }

  // ── POST /booking-pages ────────────────────────────────────────────────
  server.post(
    '/booking-pages',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        body: BookingPageCreate,
        response: {
          201: z.object({ id: z.string().uuid(), slug: z.string() }),
        },
      },
    },
    async (req, reply) => {
      const { orgId, userId } = req.auth;

      const existing = await prisma.bookingPage.findFirst({
        where: { orgId, slug: req.body.slug, deletedAt: null },
        select: { id: true },
      });
      if (existing) {
        throw server.httpErrors.conflict(
          'A booking page with this slug already exists in your org',
        );
      }

      const page = await prisma.bookingPage.create({
        data: {
          orgId,
          userId,
          slug: req.body.slug,
          name: req.body.name,
          description: req.body.description ?? null,
          durationMinutes: req.body.durationMinutes,
          bufferBeforeMinutes: req.body.bufferBeforeMinutes,
          bufferAfterMinutes: req.body.bufferAfterMinutes,
          minNoticeHours: req.body.minNoticeHours,
          maxAdvanceDays: req.body.maxAdvanceDays,
          availabilityRules: req.body.availabilityRules as Prisma.InputJsonValue,
          isActive: req.body.isActive,
          customQuestions: req.body.customQuestions as Prisma.InputJsonValue,
          redirectUrl: req.body.redirectUrl ?? null,
        },
        select: { id: true, slug: true },
      });

      return reply.code(201).send({ id: page.id, slug: page.slug });
    },
  );

  // ── PUT /booking-pages/:id ─────────────────────────────────────────────
  server.put(
    '/booking-pages/:id',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: BookingPagePatch,
        response: { 200: z.object({ id: z.string().uuid() }) },
      },
    },
    async (req, reply) => {
      const { orgId } = req.auth;

      const page = await prisma.bookingPage.findFirst({
        where: { id: req.params.id, orgId, deletedAt: null },
        select: { id: true },
      });
      if (!page) throw server.httpErrors.notFound('Booking page not found');

      // Slug conflict check only if slug is being changed
      if (req.body.slug) {
        const conflict = await prisma.bookingPage.findFirst({
          where: {
            orgId,
            slug: req.body.slug,
            deletedAt: null,
            id: { not: req.params.id },
          },
          select: { id: true },
        });
        if (conflict) throw server.httpErrors.conflict('Slug already taken in this org');
      }

      const updated = await prisma.bookingPage.update({
        where: { id: req.params.id },
        data: {
          ...(req.body.slug !== undefined ? { slug: req.body.slug } : {}),
          ...(req.body.name !== undefined ? { name: req.body.name } : {}),
          ...(req.body.description !== undefined ? { description: req.body.description } : {}),
          ...(req.body.durationMinutes !== undefined
            ? { durationMinutes: req.body.durationMinutes }
            : {}),
          ...(req.body.bufferBeforeMinutes !== undefined
            ? { bufferBeforeMinutes: req.body.bufferBeforeMinutes }
            : {}),
          ...(req.body.bufferAfterMinutes !== undefined
            ? { bufferAfterMinutes: req.body.bufferAfterMinutes }
            : {}),
          ...(req.body.minNoticeHours !== undefined
            ? { minNoticeHours: req.body.minNoticeHours }
            : {}),
          ...(req.body.maxAdvanceDays !== undefined
            ? { maxAdvanceDays: req.body.maxAdvanceDays }
            : {}),
          ...(req.body.availabilityRules !== undefined
            ? { availabilityRules: req.body.availabilityRules as Prisma.InputJsonValue }
            : {}),
          ...(req.body.isActive !== undefined ? { isActive: req.body.isActive } : {}),
          ...(req.body.customQuestions !== undefined
            ? { customQuestions: req.body.customQuestions as Prisma.InputJsonValue }
            : {}),
          ...(req.body.redirectUrl !== undefined ? { redirectUrl: req.body.redirectUrl } : {}),
        },
        select: { id: true },
      });

      return reply.send({ id: updated.id });
    },
  );

  // ── GET /booking-pages (list own pages) ───────────────────────────────
  server.get(
    '/booking-pages',
    {
      schema: {
        response: {
          200: z.object({
            items: z.array(
              z.object({
                id: z.string().uuid(),
                slug: z.string(),
                name: z.string(),
                isActive: z.boolean(),
                durationMinutes: z.number(),
                createdAt: z.string(),
              }),
            ),
          }),
        },
      },
    },
    async (req) => {
      const pages = await prisma.bookingPage.findMany({
        where: { orgId: req.auth.orgId, userId: req.auth.userId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          slug: true,
          name: true,
          isActive: true,
          durationMinutes: true,
          createdAt: true,
        },
      });
      return {
        items: pages.map((p) => ({
          ...p,
          createdAt: p.createdAt.toISOString(),
        })),
      };
    },
  );

  // ── GET /booking-pages/:slug/availability (PUBLIC) ────────────────────
  server.get(
    '/booking-pages/:slug/availability',
    {
      config: {
        auth: 'none', // bypass Clerk auth on this route
        rateLimit: { max: 60, timeWindow: '1 minute' },
      },
      schema: {
        params: z.object({ slug: z.string() }),
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

      // Scope entirely by slug — never trust a client-supplied orgId
      const page = await prisma.bookingPage.findFirst({
        where: { slug, isActive: true, deletedAt: null },
        include: {
          user: { select: { id: true, orgId: true } },
        },
      });
      if (!page) throw server.httpErrors.notFound('Booking page not found');

      // Compute the date range: the requested day
      const rangeStart = new Date(`${date}T00:00:00Z`);
      const rangeEnd = new Date(`${date}T23:59:59Z`);

      // Only look maxAdvanceDays ahead
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

      // Fetch existing events for the owner on that day (plus buffer time on each side)
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
        select: { startAt: true, endAt: true, isAllDay: true },
      });

      // Also block times that are already booked on this page
      const confirmedBookings = await prisma.booking.findMany({
        where: {
          bookingPageId: page.id,
          status: 'CONFIRMED',
          deletedAt: null,
          startAt: { lte: fetchEnd },
          endAt: { gte: fetchStart },
        },
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
        auth: 'none',
        rateLimit: { max: 5, timeWindow: '1 hour', keyGenerator: (req) => req.ip },
      },
      schema: {
        params: z.object({ slug: z.string() }),
        body: PublicBookingCreate,
        response: {
          201: z.object({
            bookingId: z.string().uuid(),
            /** ISO-8601 start time confirmed */
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
      const { attendeeName, attendeeEmail, attendeePhone, startAt: startAtRaw, answers } = req.body;

      const page = await prisma.bookingPage.findFirst({
        where: { slug, isActive: true, deletedAt: null },
        include: { user: { select: { id: true, orgId: true, email: true, name: true } } },
      });
      if (!page) throw server.httpErrors.notFound('Booking page not found');

      const startAt = new Date(startAtRaw);
      const endAt = new Date(startAt.getTime() + page.durationMinutes * 60_000);

      // Validate the slot is still available (re-run slot engine for that exact minute)
      const dayStr = startAt.toISOString().slice(0, 10);
      const rangeStart = new Date(`${dayStr}T00:00:00Z`);
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
        minNoticeHours: page.minNoticeHours,
      });

      const slotIso = startAt.toISOString();
      if (!availableSlots.includes(slotIso)) {
        throw server.httpErrors.conflict('The requested time slot is no longer available');
      }

      // Create the booking
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

      // Create a corresponding CalendarEvent for the page owner
      const calEvent = await prisma.calendarEvent.create({
        data: {
          orgId: page.user.orgId,
          ownerId: page.userId,
          externalId: null,
          provider: 'google_workspace', // will be overwritten after push
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

      // Update booking with the calendar event backref
      await prisma.booking.update({
        where: { id: booking.id },
        data: { calendarEventId: calEvent.id },
      });

      // Enqueue push to provider calendar
      try {
        const pushQueue = getPushQueue();
        await pushQueue.add('calendar.push', {
          orgId: page.user.orgId,
          userId: page.userId,
          calendarEventId: calEvent.id,
          operation: 'push',
        });
      } catch (err) {
        // Log but don't fail the booking — the sync worker will pick it up
        server.log.warn({ err, bookingId: booking.id }, 'Failed to enqueue calendar push');
      }

      // Send confirmation email to attendee — fire-and-forget, fail-open.
      // WHY: cancelToken must reach the attendee so they can cancel via the
      // public link without needing an account. The token is never returned by
      // authenticated list endpoints — the email is the only delivery channel.
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
        auth: 'none',
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

      // Enqueue delete from provider calendar if event was pushed
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

// ─── Booking confirmation email ────────────────────────────────────────────

interface BookingEmailParams {
  orgId: string;
  userId: string;
  attendeeName: string;
  attendeeEmail: string;
  ownerName: string | null;
  pageName: string;
  startAt: Date;
  endAt: Date;
  bookingId: string;
  cancelToken: string;
}

/**
 * Fire-and-forget confirmation email to the attendee.
 * WHY fail-open: email failure must never block booking creation.
 * WHY send via owner's integration: attendee has no account; owner's
 * Gmail/Outlook connection is the only outbound email path available.
 */
// Minimum log surface needed — compatible with both pino.Logger and FastifyBaseLogger.
type BookingLogger = Pick<pino.Logger, 'debug' | 'error' | 'info' | 'warn'>;

async function sendBookingConfirmationEmail(
  params: BookingEmailParams,
  log: BookingLogger,
): Promise<void> {
  const appBaseUrl = process.env['APP_BASE_URL'] ?? 'https://app.bidstack.com';
  const cancelUrl = `${appBaseUrl}/api/v1/public/bookings/${params.bookingId}/cancel?token=${params.cancelToken}`;
  const firstName = params.attendeeName.split(' ')[0] ?? params.attendeeName;
  const greeting = `Hi ${firstName},`;
  const organizer = params.ownerName ?? 'your host';

  try {
    await sendEmail(
      {
        orgId: params.orgId,
        userId: params.userId,
        to: [{ email: params.attendeeEmail, name: params.attendeeName }],
        subject: `Booking confirmed: ${params.pageName}`,
        html: buildBookingConfirmationHtml({ greeting, organizer, cancelUrl, ...params }),
        text: buildBookingConfirmationText({ greeting, organizer, cancelUrl, ...params }),
        entityType: 'booking',
        entityId: params.bookingId,
      },
      log,
    );
    log.info({ bookingId: params.bookingId }, 'bookings: confirmation email sent to attendee');
  } catch (err) {
    // WHY fail-open: email failure must never block booking creation.
    log.warn(
      { err, bookingId: params.bookingId },
      'bookings: confirmation email failed (non-fatal)',
    );
  }
}

function buildBookingConfirmationHtml(
  p: BookingEmailParams & { greeting: string; organizer: string; cancelUrl: string },
): string {
  const dateStr = p.startAt.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const startTime = p.startAt.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  });
  const endTime = p.endAt.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  });

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;font-family:system-ui,-apple-system,sans-serif;background:#f5f5f7">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:40px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;padding:48px 40px;max-width:560px">
        <tr><td>
          <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#0071e3;text-transform:uppercase;letter-spacing:0.06em">Confirmed</p>
          <h1 style="margin:0 0 24px;font-size:24px;font-weight:700;color:#1d1d1f;letter-spacing:-0.02em">${p.pageName}</h1>
          <p style="margin:0 0 8px;font-size:15px;color:#1d1d1f">${p.greeting}</p>
          <p style="margin:0 0 28px;font-size:15px;color:#1d1d1f;line-height:1.6">
            Your booking with <strong>${p.organizer}</strong> is confirmed.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;border-radius:12px;padding:20px 24px;margin-bottom:28px">
            <tr>
              <td style="font-size:13px;color:#6e6e73;padding-bottom:8px">Date</td>
              <td style="font-size:15px;font-weight:600;color:#1d1d1f;text-align:right;padding-bottom:8px">${dateStr}</td>
            </tr>
            <tr>
              <td style="font-size:13px;color:#6e6e73">Time</td>
              <td style="font-size:15px;font-weight:600;color:#1d1d1f;text-align:right">${startTime} – ${endTime}</td>
            </tr>
          </table>
          <p style="margin:0 0 8px;font-size:13px;color:#6e6e73">
            Need to cancel? Use the link below — no account required.
          </p>
          <a href="${p.cancelUrl}" style="font-size:13px;color:#6e6e73">${p.cancelUrl}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildBookingConfirmationText(
  p: BookingEmailParams & { greeting: string; organizer: string; cancelUrl: string },
): string {
  const dateStr = p.startAt.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const startTime = p.startAt.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  });
  const endTime = p.endAt.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  });
  return [
    p.greeting,
    '',
    `Your booking "${p.pageName}" with ${p.organizer} is confirmed.`,
    '',
    `Date: ${dateStr}`,
    `Time: ${startTime} – ${endTime}`,
    '',
    'To cancel your booking, visit:',
    p.cancelUrl,
  ].join('\n');
}

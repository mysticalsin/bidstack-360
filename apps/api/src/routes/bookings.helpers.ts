// Booking page — shared Zod schemas, types, and email helper.
//
// Used by:
//   bookings-pages.ts  — authenticated page CRUD routes
//   bookings-public.ts — public availability + booking + cancel routes

import type pino from 'pino';
import { z } from 'zod';
import {
  type BookingEmailParams,
  buildBookingConfirmationHtml,
  buildBookingConfirmationText,
} from './booking-email.js';
import { sendEmail } from '../services/email-integration.service.js';

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const AvailabilityRuleSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:mm'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:mm'),
});

export const CustomQuestionSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(['text', 'select', 'phone']),
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(),
});

export const BookingPageCreate = z.object({
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

export const BookingPagePatch = BookingPageCreate.partial();

export const PublicBookingCreate = z.object({
  attendeeName: z.string().min(1).max(120),
  attendeeEmail: z.string().email().max(254),
  attendeePhone: z.string().max(30).optional(),
  startAt: z.string().datetime(),
  /** Answers keyed by customQuestion.id */
  answers: z.record(z.unknown()).default({}),
  /** IANA timezone used to validate the selected slot against page availability. */
  tz: z.string().max(50).default('UTC'),
});

// ─── Email helper ─────────────────────────────────────────────────────────────

/** Minimum log surface — compatible with both pino.Logger and FastifyBaseLogger. */
export type BookingLogger = Pick<pino.Logger, 'debug' | 'error' | 'info' | 'warn'>;

/**
 * Fire-and-forget confirmation email to the attendee.
 * WHY fail-open: email failure must never block booking creation.
 * WHY send via owner's integration: attendee has no account; owner's
 * Gmail/Outlook connection is the only outbound email path available.
 */
export async function sendBookingConfirmationEmail(
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

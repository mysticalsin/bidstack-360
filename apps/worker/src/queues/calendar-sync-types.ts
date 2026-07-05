// Types, interfaces, Zod schemas, and error classes for the calendar-sync worker.

import type IORedis from 'ioredis';
import type pino from 'pino';
import { z } from 'zod';

// ─── Job data schemas ──────────────────────────────────────────────────────

export const PushJobData = z.object({
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
  calendarEventId: z.string().uuid(),
  /** push | update | delete */
  operation: z.enum(['push', 'update', 'delete']),
});

export const PullJobData = z.object({
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
  integrationTokenId: z.string().uuid(),
});

// ─── Shared push parameters ────────────────────────────────────────────────

export interface PushParams {
  event: {
    id: string;
    orgId: string;
    externalId: string | null;
    subject: string;
    bodyPreview: string | null;
    startAt: Date;
    endAt: Date;
    location: string | null;
    attendees: unknown;
    etag: string | null;
  };
  operation: 'push' | 'update' | 'delete';
  accessToken: string;
  /** Redis connection + BullMQ job id for the per-job push idempotency claim (calendar-sync-claim.ts) */
  connection: IORedis;
  jobId: string;
  log: pino.Logger;
}

// ─── Error types ───────────────────────────────────────────────────────────

export class CalendarConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalendarConflictError';
  }
}

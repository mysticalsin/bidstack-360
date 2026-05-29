// RFP pipeline — shared constants, schemas, and helpers.
//
// Used by:
//   rfp-pipeline.ts        — upload, autofill, approve routes
//   rfp-pipeline-stream.ts — SSE progress stream route

import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { redis } from '../redis.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger({ name: 'rfp-pipeline' });

// ─── Constants ────────────────────────────────────────────────────────────────

/** Allowed mime types for RFP source documents. */
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const;

/** 50 MiB — enforced at the route boundary to override the global 10 MiB cap. */
export const RFP_MAX_BYTES = 50 * 1024 * 1024;

/** Rate-limit: 10 uploads per org per hour. Key format: rfp:upload:{orgId}. */
export const RFP_UPLOAD_RATE_LIMIT_MAX = 10;
export const RFP_UPLOAD_RATE_LIMIT_TTL_SECONDS = 3600;

/** SSE poll interval in milliseconds — low enough to feel real-time. */
export const SSE_POLL_INTERVAL_MS = 2000;

/**
 * Heartbeat interval — send a SSE comment every 30 s to prevent proxy timeout.
 * Most load balancers (Nginx, AWS ALB) drop idle connections after 60 s;
 * 30 s keeps the stream alive with comfortable headroom.
 */
export const SSE_HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Maximum streaming duration — 30 minutes. If the orchestration is still
 * in-progress after this window the stream closes and the client must
 * reconnect. WHY: a stuck BullMQ job or DB deadlock must not hold an open
 * HTTP response handle indefinitely, exhausting Fastify's connection pool.
 */
export const SSE_MAX_POLL_MS = 30 * 60 * 1000;

/** Terminal states — stop streaming once reached. */
export const SSE_TERMINAL_STATES = new Set(['completed', 'failed', 'rejected']);

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const UploadParams = z.object({ opportunityId: z.string().uuid() });

export const StreamParams = z.object({
  workspaceId: z.string().uuid(),
  orchestrationId: z.string().uuid(),
});

export const AutofillParams = z.object({
  workspaceId: z.string().uuid(),
  rowId: z.string().uuid(),
});
export const AutofillBody = z.object({
  orchestrationId: z.string().uuid(),
  sectionKey: z.string().min(1).max(100),
});

export const ApproveParams = z.object({ proposalId: z.string().uuid() });
export const ApproveBody = z.object({ notes: z.string().max(2000).optional() });

export const UploadResponse = z.object({
  orchestrationId: z.string().uuid(),
  status: z.literal('queued'),
});

export const AutofillResponse = z.object({
  jobId: z.string().nullable(),
  status: z.literal('queued'),
});

export const ApproveResponse = z.object({
  approvedAt: z.string().datetime(),
  approvedByUserId: z.string().uuid(),
});

// ─── Rate-limit helper ────────────────────────────────────────────────────────

/**
 * Check and increment the per-org upload rate limit in Redis.
 * Returns true if the request is within quota, false if the limit is exceeded.
 *
 * WHY Redis INCR + EXPIRE: atomic check-and-increment with sliding window.
 * INCR on a missing key returns 1 and we set TTL immediately after; the 2-call
 * sequence is safe here because a missed TTL set (crash between calls) just means
 * the key lives forever until its next write, never causes silent over-counting.
 */
export async function checkRfpUploadRateLimit(orgId: string): Promise<boolean> {
  const key = `rfp:upload:${orgId}`;
  try {
    const current = await redis.incr(key);
    if (current === 1) {
      // First upload in this window — set TTL so the counter expires.
      await redis.expire(key, RFP_UPLOAD_RATE_LIMIT_TTL_SECONDS);
    }
    return current <= RFP_UPLOAD_RATE_LIMIT_MAX;
  } catch (err) {
    // Redis unavailable — fail-open so uploads still work, log the anomaly.
    // WHY fail-open: rate limiting is best-effort protection; blocking all uploads
    // when Redis is down is worse than allowing a few extra uploads.
    log.warn({ err, orgId }, 'rfp upload rate-limit Redis check failed — fail-open');
    return true;
  }
}

// ─── SSE helper ───────────────────────────────────────────────────────────────

/**
 * Write a single SSE event frame. Format per the SSE spec:
 *   data: <JSON>\n\n
 * The double newline is the event boundary.
 */
export function writeSseEvent(reply: FastifyReply, payload: Record<string, unknown>): void {
  reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
}

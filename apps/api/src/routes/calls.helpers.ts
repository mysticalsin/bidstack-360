/**
 * calls.helpers.ts — shared Zod schemas and auth helper for call routes.
 *
 * Extracted from calls.ts (BS-R1 file-size refactor).
 * Consumed by calls.write.routes.ts and calls.read.routes.ts.
 */
import { z } from 'zod';

export const EntityTypeEnum = z.enum(['DEAL', 'CONTACT', 'OPPORTUNITY', 'LEAD']);
export const ProviderEnum = z.enum(['ZOOM', 'TEAMS', 'GOOGLE_MEET', 'TWILIO_VOICE']);

export const CallSessionSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
  entityType: z.string(),
  entityId: z.string().uuid(),
  provider: z.string(),
  externalMeetingId: z.string().nullable(),
  joinUrl: z.string().nullable(),
  scheduledAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  durationSec: z.number().nullable(),
  participantEmails: z.unknown().nullable(),
  recordingUrl: z.string().nullable(),
  summary: z.string().nullable(),
  actionItems: z.unknown().nullable(),
  sentimentScore: z.number().nullable(),
  talkRatio: z.unknown().nullable(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** WHY cast: authPlugin populates req.auth; narrowing avoids circular dep on auth types. */
export function getAuth(req: unknown): { orgId: string; userId: string } {
  return (req as { auth: { orgId: string; userId: string } }).auth;
}

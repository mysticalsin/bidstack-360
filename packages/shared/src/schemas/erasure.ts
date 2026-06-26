import { z } from 'zod';

// GDPR Article 17 (right to erasure) wire shapes.
//
// An org-admin anonymizes a single data subject — a Contact or a Lead ("person"
// entities) — by id. The subject's PII is scrubbed to deterministic tombstones
// and the row is soft-deleted; the action is recorded in the audit log. There is
// no separate erasure-request resource (the audit log is the durable record), so
// the request is a single POST that returns a summary of what was erased.

/** The person entities a data subject can map to. */
export const ErasureSubjectType = z.enum(['contact', 'lead']);
export type ErasureSubjectType = z.infer<typeof ErasureSubjectType>;

/** Path params for the erasure route. */
export const ErasureOrgParams = z.object({
  orgId: z.string().uuid(),
});
export type ErasureOrgParams = z.infer<typeof ErasureOrgParams>;

/** Request body: which data subject to erase. */
export const ErasureRequest = z.object({
  subjectType: ErasureSubjectType,
  subjectId: z.string().uuid(),
});
export type ErasureRequest = z.infer<typeof ErasureRequest>;

/**
 * Summary of an erasure. `scrubbedFields` lists the PII fields that held a real
 * value and were tombstoned (empty on an idempotent re-run — nothing left to
 * scrub). `relatedScrubbed` reports counts of directly-reachable child PII that
 * was also scrubbed (e.g. a contact's activity-attendee email copies).
 */
export const ErasureSummary = z.object({
  subjectType: ErasureSubjectType,
  subjectId: z.string().uuid(),
  scrubbedFields: z.array(z.string()),
  relatedScrubbed: z.record(z.number().int().nonnegative()),
  erasedAt: z.string().datetime(),
});
export type ErasureSummary = z.infer<typeof ErasureSummary>;

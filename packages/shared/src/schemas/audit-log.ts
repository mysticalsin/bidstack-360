import { z } from 'zod';

// AuditLog rows are read-only. The DB stores them with a BigInt PK; we expose
// it as a string on the wire so JSON consumers don't lose precision and the
// cursor stays stable across pages.

export const AuditLogEntry = z.object({
  id: z.string(),
  action: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  userId: z.string().uuid().nullable(),
  userName: z.string().nullable(),
  userEmail: z.string().nullable(),
  diff: z.unknown().nullable(),
  createdAt: z.string().datetime(),
});
export type AuditLogEntry = z.infer<typeof AuditLogEntry>;

// Filters are coerced because the API consumes them from query strings.
// `accountId` filters rows where the targetId matches OR the diff JSON has an
// `accountId` field — that covers both opportunity-shaped and CRM-enrichment
// audit rows that reference an account but target a different entity.
export const AuditLogFilter = z.object({
  accountId: z.string().optional(),
  action: z.string().optional(),
  targetType: z.string().optional(),
  since: z.string().datetime().optional(),
  // Cursor encodes the auto-incrementing AuditLog.id (BigInt) as a decimal
  // string. Restricting to digits stops garbage input from reaching the
  // BigInt(cursor) cast in the route handler — a non-numeric value would
  // raise SyntaxError and surface as an opaque 500.
  cursor: z.string().regex(/^\d+$/, 'cursor must be a positive integer string').optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type AuditLogFilter = z.infer<typeof AuditLogFilter>;

export const AuditLogPage = z.object({
  items: z.array(AuditLogEntry),
  nextCursor: z.string().nullable(),
});
export type AuditLogPage = z.infer<typeof AuditLogPage>;

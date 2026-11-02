// Note schemas — wire contract for /api/notes.
// Notes are freeform markdown attached to a customer account. The accountId
// is intentionally a free-form string (not UUID) because companies are
// derived from opportunities/contacts and not yet a first-class table.

import { z } from 'zod';

import { ComplianceCheck, RiskItem, SourceAttribution, TechnicalStackCategory } from './crm.js';

// Why 200 chars: short enough to stay readable in a list-row, long enough to
// hold a full sentence. Matches DB VARCHAR(200) — keep in sync with schema.
const TITLE_MAX = 200;

// Why 32k chars: well above any realistic single-note body, well below
// PostgreSQL's TEXT/JSON request-body limits. Guards against accidental
// paste of an entire document. Tune up if a real use case demands more.
const BODY_MAX = 32_000;

export const Note = z.object({
  id: z.string().uuid(),
  accountId: z.string().min(1).max(255),
  companyId: z.string().uuid().optional(),
  title: z.string().min(1).max(TITLE_MAX),
  bodyMd: z.string().max(BODY_MAX),
  pinned: z.boolean(),
  authorUserId: z.string().uuid(),
  // Author email is convenient for display so the UI doesn't need a second
  // round-trip to /users. Nullable because a deleted user could leave an
  // orphan reference, even though the FK is RESTRICT today.
  authorEmail: z.string().email().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Note = z.infer<typeof Note>;

export const NoteCreate = z.object({
  accountId: z.string().min(1).max(255),
  companyId: z.string().uuid().optional(),
  title: z.string().min(1).max(TITLE_MAX),
  bodyMd: z.string().max(BODY_MAX),
  pinned: z.boolean().optional().default(false),
});
export type NoteCreate = z.infer<typeof NoteCreate>;

// PATCH body: every field optional. We deliberately do NOT allow accountId
// or authorUserId to be patched — moving a note to another account or
// changing authorship would be a different operation with different audit
// semantics.
export const NotePatch = z
  .object({
    title: z.string().min(1).max(TITLE_MAX).optional(),
    bodyMd: z.string().max(BODY_MAX).optional(),
    pinned: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'PATCH body must contain at least one field',
  });
export type NotePatch = z.infer<typeof NotePatch>;

export const NoteList = z.object({ items: z.array(Note) });
export type NoteList = z.infer<typeof NoteList>;

export const MeetingNotesImportRequest = z.object({
  accountId: z.string().min(1).max(255),
  companyId: z.string().uuid().optional(),
  companyName: z.string().min(1).max(255),
  domain: z.string().trim().min(3).max(255).optional(),
  title: z.string().min(1).max(TITLE_MAX).optional(),
  bodyMd: z.string().min(10).max(BODY_MAX),
});
export type MeetingNotesImportRequest = z.infer<typeof MeetingNotesImportRequest>;

export const MeetingImportedContact = z.object({
  name: z.string().min(1),
  title: z.string().nullable(),
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
  roleInDecision: z.enum(['buyer', 'blocker', 'champion', 'influencer', 'user']).nullable(),
  confidence: z.number().min(0).max(1),
});
export type MeetingImportedContact = z.infer<typeof MeetingImportedContact>;

export const MeetingImportedTask = z.object({
  title: z.string().min(1).max(255),
  dueDate: z.string().date().nullable(),
  status: z.enum(['open', 'in_progress', 'done', 'blocked']),
  confidence: z.number().min(0).max(1),
});
export type MeetingImportedTask = z.infer<typeof MeetingImportedTask>;

export const MeetingNotesImportResponse = z.object({
  note: Note,
  extracted: z.object({
    techStack: z.array(TechnicalStackCategory),
    contacts: z.array(MeetingImportedContact),
    risks: z.array(RiskItem),
    compliance: z.array(ComplianceCheck),
    tasks: z.array(MeetingImportedTask),
    sourceAttribution: z.array(SourceAttribution),
  }),
  created: z.object({
    contacts: z.number().int().nonnegative(),
    risks: z.number().int().nonnegative(),
    compliance: z.number().int().nonnegative(),
    tasks: z.number().int().nonnegative(),
    techStackItems: z.number().int().nonnegative(),
  }),
});
export type MeetingNotesImportResponse = z.infer<typeof MeetingNotesImportResponse>;

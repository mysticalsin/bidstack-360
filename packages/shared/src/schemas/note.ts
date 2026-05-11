// Note schemas — wire contract for /api/notes.
// Notes are freeform markdown attached to a customer account. The accountId
// is intentionally a free-form string (not UUID) because companies are
// derived from opportunities/contacts and not yet a first-class table.

import { z } from 'zod';

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

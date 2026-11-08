/**
 * GDPR data subject engine: resolve a person, export everything held about
 * them (Art. 15, 20), erase it (Art. 17) with a dry run, and scan for residue.
 *
 * One handler per SUBJECT_STORE (personal-data-map.ts). Every erase first
 * plans (finds matching row ids in every store), then applies the plan in one
 * transaction together with its `gdpr.erasure` audit row, so a failure leaves
 * nothing half erased. A dry run stops after planning.
 *
 * Sidecar erasure runs as raw SQL: JSON and array columns (attendees,
 * recipients, participants) are filtered element by element, which the Prisma
 * client cannot express. Raw SQL also bypasses the soft-delete middleware,
 * which would otherwise hide already soft-deleted rows from the erasure.
 * Identifiers are bound parameters; table and column names come from the
 * Prisma DMMF only.
 *
 * Audit log: hash chained and append-only (migration
 * 20261107070020_audit_log_hash_chain_triggers). Rows are never rewritten.
 * Erasure pseudonymises them instead: the subject id they point at no longer
 * resolves to a person once the subject row is tombstoned. Diffs written
 * before audit writers were made id-only can still hold a name; the residue
 * scan reports those as retained.
 */
import { createHash } from 'node:crypto';

import { Prisma, type PrismaClient } from '../../generated/client/index.js';

import {
  SUBJECT_STORES,
  personalFieldsInSchema,
  type SchemaModel,
  type SubjectStoreModel,
} from './personal-data-map.js';

export type DataSubjectType = 'contact' | 'lead' | 'account_person';

export interface DataSubject {
  orgId: string;
  subjectType: DataSubjectType;
  subjectId: string;
  contactIds: string[];
  leadIds: string[];
  nodeIds: string[];
  /** Lowercased email addresses. */
  emails: string[];
  /** Phone numbers as stored, 7 digits or more. */
  phones: string[];
  /** The same numbers reduced to digits, for column equality. */
  phoneDigits: string[];
  /** Lowercased full names: two words or more, 5 characters or more. */
  names: string[];
}

export interface DataSubjectBundle {
  subject: { type: DataSubjectType; id: string };
  generatedAt: string;
  stores: Record<string, Array<Record<string, unknown>>>;
}

export interface ResidueHit {
  model: string;
  field: string;
  rows: number;
  retained: boolean;
}

export interface EraseReport {
  kind: 'erase';
  dryRun: boolean;
  subjectType: DataSubjectType;
  subjectId: string;
  scrubbedFields: string[];
  /** rows: linked rows erased; mentions: other records where only the matching text was redacted. */
  stores: Record<string, { action: string; rows: number; mentions: number }>;
  retained: Record<string, { rows: number; basis: string }>;
  auditRowsPseudonymised: number;
}

type Db = Prisma.TransactionClient;

export const TOMBSTONE = { name: 'Erased subject', freeText: '[erased]', phone: 'erased' } as const;

/**
 * Deterministic, non-routable tombstone address (RFC 2606 `.invalid`). Derived
 * from (orgId, subjectId) so re-runs are stable and it cannot be reversed.
 */
export function tombstoneEmail(orgId: string, subjectId: string): string {
  const hash = createHash('sha256').update(`${orgId}:${subjectId}`).digest('hex').slice(0, 16);
  return `erased+${hash}@erased.invalid`;
}

// ─── DMMF helpers ────────────────────────────────────────────────────────────

const MODELS = Prisma.dmmf.datamodel.models as unknown as SchemaModel[];
const MODEL_BY_NAME = new Map(MODELS.map((m) => [m.name, m]));

function meta(model: string): SchemaModel {
  const m = MODEL_BY_NAME.get(model);
  if (!m) throw new Error(`data-subject: unknown model ${model}`);
  return m;
}

function T(model: string): Prisma.Sql {
  const m = meta(model);
  return Prisma.raw(`"${m.dbName ?? m.name}"`);
}

function C(model: string, field: string): Prisma.Sql {
  const f = meta(model).fields.find((x) => x.name === field);
  if (!f || f.kind === 'object') throw new Error(`data-subject: unknown column ${model}.${field}`);
  return Prisma.raw(`"${f.dbName ?? f.name}"`);
}

function hasField(model: string, field: string): boolean {
  return meta(model).fields.some((f) => f.name === field);
}

function delegate(db: Db, model: string) {
  const key = model.charAt(0).toLowerCase() + model.slice(1);
  return (
    db as unknown as Record<
      string,
      { findMany(args: unknown): Promise<Array<Record<string, unknown>>> }
    >
  )[key]!;
}

// ─── Subject pattern ─────────────────────────────────────────────────────────

const FALSE = Prisma.sql`FALSE`;
export const REDACTED = '[erased]';

/** Escape a literal for a PostgreSQL advanced regular expression. */
function reEscape(v: string): string {
  return v.replace(/[\\^$.|?*+()[\]{}]/g, (c) => `\\${c}`);
}

/**
 * One case-insensitive PostgreSQL regex for the subject's identifiers. Tokens
 * carry boundaries: `an@acme.com` never matches `dan@acme.com`, a phone never
 * matches inside a longer number, and a name matches only as the whole
 * phrase. Null when the subject has no usable identifier.
 */
export function subjectPattern(s: Pick<DataSubject, 'emails' | 'phones' | 'names'>): string | null {
  const parts = [
    ...s.emails.map((e) => `(?<![[:alnum:]._%+-])${reEscape(e)}(?![[:alnum:]_%+-]|\\.[[:alnum:]])`),
    ...s.phones.map((p) => `(?<![[:digit:]])${reEscape(p)}(?![[:digit:]])`),
    ...s.names.map((n) => `\\m${n.split(/\s+/).map(reEscape).join('\\s+')}\\M`),
  ];
  return parts.length ? `(${parts.join('|')})` : null;
}

/** Emails and phones only: used on other people's identity columns, where a shared name is not the subject. */
function identifierPattern(s: Pick<DataSubject, 'emails' | 'phones'>): string | null {
  return subjectPattern({ emails: s.emails, phones: s.phones, names: [] });
}

/**
 * Columns that identify the record's own person. On a record linked to the
 * subject they are erased; on anyone else's record they are left alone, so a
 * namesake keeps their name.
 */
const IDENTITY_FIELDS: Record<string, readonly string[]> = {
  Contact: ['name', 'email', 'phone'],
  Lead: ['firstName', 'lastName', 'email', 'phone'],
  OrgChartNode: ['name', 'email', 'phone', 'linkedinUrl'],
  ActivityAttendee: ['email'],
  MeetingIntelAttendee: ['name', 'email'],
  Booking: ['attendeeName', 'attendeeEmail', 'attendeePhone'],
  Reference: ['contactName', 'contactEmail'],
  SmsMessage: ['toNumber', 'fromNumber'],
  SmsConsent: ['phoneNumber'],
  EmailMessage: ['fromEmail'],
  CalendarEvent: ['organizerEmail'],
};

function isIdentityField(model: string, field: string): boolean {
  return IDENTITY_FIELDS[model]?.includes(field) ?? false;
}

/** Personal fields of a record that only mentions the subject: free text, never its own identity columns. */
function mentionFields(model: string): readonly string[] {
  return (STORE_FIELDS.get(model as SubjectStoreModel) ?? []).filter(
    (f) => !isIdentityField(model, f),
  );
}

function fieldMeta(model: string, field: string) {
  const f = meta(model).fields.find((x) => x.name === field);
  if (!f || f.kind === 'object') throw new Error(`data-subject: unknown column ${model}.${field}`);
  return f;
}

function uuidIn(model: string, field: string, ids: string[]): Prisma.Sql {
  return ids.length ? Prisma.sql`${C(model, field)} = ANY(${ids}::uuid[])` : FALSE;
}

/** Exact, case-insensitive equality on an identifier column. */
function lowerIn(model: string, field: string, values: string[]): Prisma.Sql {
  return values.length
    ? Prisma.sql`lower(${C(model, field)}::text) = ANY(${values}::text[])`
    : FALSE;
}

/** Phone column equal to one of the subject's numbers, compared on digits only. */
function phoneIn(model: string, field: string, digits: string[]): Prisma.Sql {
  return digits.length
    ? Prisma.sql`regexp_replace(${C(model, field)}, '[^0-9]', '', 'g') = ANY(${digits}::text[])`
    : FALSE;
}

/** A jsonb array (attendees, recipients) holds an entry whose email is one of the subject's. */
function jsonHasEmail(model: string, field: string, emails: string[]): Prisma.Sql {
  if (!emails.length) return FALSE;
  const col = C(model, field);
  return Prisma.sql`(CASE WHEN jsonb_typeof(${col}) = 'array' THEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(${col}) e
       WHERE lower(CASE jsonb_typeof(e) WHEN 'string' THEN e #>> '{}' ELSE e ->> 'email' END)
             = ANY(${emails}::text[])) ELSE false END)`;
}

/**
 * One column matches the pattern. JSON and list values are tested on their
 * decoded strings: in the text form an escape such as `\n` sits right before
 * the next word and would hide a name from the word boundary.
 */
function matches(model: string, field: string, re: string): Prisma.Sql {
  const f = fieldMeta(model, field);
  const col = C(model, field);
  if (f.type === 'Json') {
    return Prisma.sql`(${col} IS NOT NULL AND gdpr_redact_jsonb(${col}, ${re}, '') IS DISTINCT FROM ${col})`;
  }
  if (f.isList) return Prisma.sql`EXISTS (SELECT 1 FROM unnest(${col}) x WHERE x::text ~* ${re})`;
  return Prisma.sql`${col}::text ~* ${re}`;
}

function anyMatch(model: string, fields: readonly string[], re: string | null): Prisma.Sql {
  if (!re || !fields.length) return FALSE;
  return Prisma.sql`(${Prisma.join(
    fields.map((f) => matches(model, f, re)),
    ' OR ',
  )})`;
}

/** SET expression replacing every match of the subject pattern in a column with REDACTED. */
function redactExpr(model: string, field: string, re: string): Prisma.Sql {
  const f = fieldMeta(model, field);
  const col = C(model, field);
  if (f.type === 'Json') return Prisma.sql`gdpr_redact_jsonb(${col}, ${re}, ${REDACTED})`;
  if (f.isList) {
    return Prisma.sql`CASE WHEN ${col} IS NULL THEN NULL ELSE array(SELECT regexp_replace(x, ${re}, ${REDACTED}, 'gi')
                              FROM unnest(${col}) WITH ORDINALITY AS u(x, i) ORDER BY i) END`;
  }
  return Prisma.sql`regexp_replace(${col}, ${re}, ${REDACTED}, 'gi')`;
}

/**
 * A jsonb array column (attendees, recipients) without the subject's entry:
 * matched on the entry's email, or on its exact name only when it has no
 * email, so a namesake with their own address stays.
 */
function jsonWithout(model: string, field: string, s: DataSubject): Prisma.Sql {
  const col = C(model, field);
  if (!s.emails.length && !s.names.length) return col;
  return Prisma.sql`CASE WHEN jsonb_typeof(${col}) = 'array' THEN coalesce((
      SELECT jsonb_agg(e ORDER BY i) FROM jsonb_array_elements(${col}) WITH ORDINALITY AS t(e, i)
       WHERE NOT coalesce(CASE jsonb_typeof(e)
         WHEN 'string' THEN lower(e #>> '{}') = ANY(${s.emails}::text[])
         WHEN 'object' THEN CASE WHEN nullif(e ->> 'email', '') IS NOT NULL
                                 THEN lower(e ->> 'email') = ANY(${s.emails}::text[])
                                 ELSE lower(regexp_replace(trim(e ->> 'name'), '\\s+', ' ', 'g')) = ANY(${s.names}::text[]) END
         ELSE false END, false)), '[]'::jsonb) ELSE ${col} END`;
}

/** A text[] of attendee names or addresses with the entries that are exactly the subject. */
function exactEntry(x: Prisma.Sql, s: DataSubject): Prisma.Sql {
  return Prisma.sql`lower(regexp_replace(trim(${x}), '\\s+', ' ', 'g')) = ANY(${[...s.names, ...s.emails]}::text[])`;
}

/** A text[] column without the entries that are exactly the subject. */
function arrayWithout(model: string, field: string, s: DataSubject): Prisma.Sql {
  const col = C(model, field);
  return Prisma.sql`CASE WHEN ${col} IS NULL THEN NULL ELSE array(SELECT x FROM unnest(${col}) WITH ORDINALITY AS u(x, i)
                           WHERE NOT coalesce(${exactEntry(Prisma.sql`x`, s)}, false) ORDER BY i) END`;
}

async function idsWhere(
  db: Db,
  model: string,
  orgId: string,
  clause: Prisma.Sql,
): Promise<string[]> {
  const rows = await db.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id::text AS id FROM ${T(model)}
                WHERE ${C(model, 'orgId')} = ${orgId}::uuid AND (${clause})`,
  );
  return rows.map((r) => r.id);
}

function subjectIds(s: DataSubject): string[] {
  return [...s.contactIds, ...s.leadIds, ...s.nodeIds];
}

// ─── Handlers ────────────────────────────────────────────────────────────────
//
// Each store separates rows LINKED to the subject (id link or exact identifier
// column: the subject is a party to the record) from rows that only MENTION
// them in free text. Linked rows get the structural erasure below (tombstone,
// delete, drop the attendee or recipient entry). Every matched row then has
// the subject's identifiers replaced with REDACTED in the store's personal
// fields (personal-data-map.ts), so a third party's record is never deleted or
// wiped because it mentions the subject.

interface Handler {
  linked(db: Db, s: DataSubject): Promise<string[]>;
  /** Structural erasure of linked rows. Returns rows kept under a legal basis. */
  erase?(db: Db, s: DataSubject, ids: string[]): Promise<number | void>;
  rows?(db: Db, ids: string[]): Promise<Array<Record<string, unknown>>>;
}

const none = async (): Promise<string[]> => [];

function callSessionLinked(db: Db, s: DataSubject): Promise<string[]> {
  return idsWhere(
    db,
    'CallSession',
    s.orgId,
    Prisma.sql`${uuidIn('CallSession', 'entityId', subjectIds(s))}
      OR ${jsonHasEmail('CallSession', 'participantEmails', s.emails)}`,
  );
}

function emailMessageLinked(db: Db, s: DataSubject): Promise<string[]> {
  return idsWhere(
    db,
    'EmailMessage',
    s.orgId,
    Prisma.sql`${lowerIn('EmailMessage', 'fromEmail', s.emails)}
      OR ${uuidIn('EmailMessage', 'entityId', subjectIds(s))}
      OR ${jsonHasEmail('EmailMessage', 'toEmails', s.emails)}
      OR ${jsonHasEmail('EmailMessage', 'ccEmails', s.emails)}`,
  );
}

/**
 * Attendee rows for the subject: by contact id or email, or by exact name when
 * the row has no email. `strong` drops the name rule (used before wiping a
 * whole transcript, where a namesake must not count).
 */
function meetingAttendeeLinked(db: Db, s: DataSubject, strong = false): Promise<string[]> {
  const m = 'MeetingIntelAttendee';
  return idsWhere(
    db,
    m,
    s.orgId,
    Prisma.sql`${uuidIn(m, 'contactId', s.contactIds)}
      OR ${lowerIn(m, 'email', s.emails)}
      ${strong ? Prisma.empty : Prisma.sql`OR (${C(m, 'email')} IS NULL AND ${C(m, 'contactId')} IS NULL AND ${lowerIn(m, 'name', s.names)})`}`,
  );
}

const HANDLERS: Record<SubjectStoreModel, Handler> = {
  Contact: {
    linked: async (_db, s) => s.contactIds,
    async erase(db, s, ids) {
      const now = new Date();
      const rows = await inChunks(ids, (chunk) =>
        db.contact.findMany({
          where: { id: { in: chunk }, orgId: s.orgId, deletedAt: { not: undefined } },
          select: { id: true, email: true, deletedAt: true },
          take: chunk.length,
        }),
      );
      for (const c of rows) {
        await db.contact.update({
          where: { id: c.id, deletedAt: { not: undefined } },
          data: {
            name: TOMBSTONE.name,
            email: c.email === null ? null : tombstoneEmail(s.orgId, c.id),
            emailHash: null,
            phone: null,
            role: null,
            deletedAt: c.deletedAt ?? now,
          },
        });
      }
      await db.$executeRaw`UPDATE ${T('Contact')} SET ${C('Contact', 'reportsToContactId')} = NULL
                            WHERE ${uuidIn('Contact', 'reportsToContactId', ids)}`;
    },
  },
  Lead: {
    linked: async (_db, s) => s.leadIds,
    async erase(db, s, ids) {
      const now = new Date();
      const rows = await inChunks(ids, (chunk) =>
        db.lead.findMany({
          where: { id: { in: chunk }, orgId: s.orgId, deletedAt: { not: undefined } },
          select: { id: true, email: true, notes: true, intel: true, deletedAt: true },
          take: chunk.length,
        }),
      );
      for (const l of rows) {
        await db.lead.update({
          where: { id: l.id, deletedAt: { not: undefined } },
          data: {
            firstName: TOMBSTONE.name,
            lastName: '',
            email: l.email === null ? null : tombstoneEmail(s.orgId, l.id),
            emailHash: null,
            phone: null,
            title: null,
            notes: l.notes === null ? null : TOMBSTONE.freeText,
            intel: l.intel === null ? undefined : Prisma.JsonNull,
            deletedAt: l.deletedAt ?? now,
          },
        });
      }
    },
  },
  OrgChartNode: {
    linked: (db, s) =>
      idsWhere(
        db,
        'OrgChartNode',
        s.orgId,
        Prisma.sql`${uuidIn('OrgChartNode', 'id', s.nodeIds)}
          OR ${uuidIn('OrgChartNode', 'contactId', s.contactIds)}
          OR ${lowerIn('OrgChartNode', 'email', s.emails)}`,
      ),
    async erase(db, _s, ids) {
      const m = 'OrgChartNode';
      await db.$executeRaw`UPDATE ${T(m)} SET ${C(m, 'name')} = ${TOMBSTONE.name},
          ${C(m, 'title')} = NULL, ${C(m, 'email')} = NULL, ${C(m, 'phone')} = NULL,
          ${C(m, 'linkedinUrl')} = NULL, ${C(m, 'photoUrl')} = NULL, ${C(m, 'photoStorageKey')} = NULL,
          ${C(m, 'profile')} = NULL, ${C(m, 'importRef')} = NULL, ${C(m, 'externalRef')} = NULL,
          ${C(m, 'deletedAt')} = coalesce(${C(m, 'deletedAt')}, now())
        WHERE id = ANY(${ids}::uuid[])`;
    },
  },
  ActivityAttendee: {
    linked: (db, s) =>
      idsWhere(
        db,
        'ActivityAttendee',
        s.orgId,
        Prisma.sql`${uuidIn('ActivityAttendee', 'contactId', s.contactIds)}
          OR ${lowerIn('ActivityAttendee', 'email', s.emails)}`,
      ),
    async erase(db, _s, ids) {
      await db.$executeRaw`UPDATE ${T('ActivityAttendee')} SET ${C('ActivityAttendee', 'email')} = NULL
                            WHERE id = ANY(${ids}::uuid[])`;
    },
  },
  Activity: {
    linked: (db, s) =>
      idsWhere(db, 'Activity', s.orgId, uuidIn('Activity', 'entityId', subjectIds(s))),
    async erase(db, _s, ids) {
      const m = 'Activity';
      await db.$executeRaw`UPDATE ${T(m)} SET ${C(m, 'subject')} = ${TOMBSTONE.freeText},
          ${C(m, 'description')} = NULL, ${C(m, 'body')} = '{}'::jsonb, ${C(m, 'metadata')} = '{}'::jsonb,
          ${C(m, 'deletedAt')} = coalesce(${C(m, 'deletedAt')}, now())
        WHERE id = ANY(${ids}::uuid[])`;
    },
  },
  ContactFact: {
    linked: (db, s) =>
      idsWhere(
        db,
        'ContactFact',
        s.orgId,
        Prisma.sql`${uuidIn('ContactFact', 'contactId', s.contactIds)}
          OR ${uuidIn('ContactFact', 'reportsToContactId', s.contactIds)}`,
      ),
    async erase(db, s, ids) {
      const m = 'ContactFact';
      await db.$executeRaw`DELETE FROM ${T(m)} WHERE id = ANY(${ids}::uuid[])
          AND ${uuidIn(m, 'contactId', s.contactIds)}`;
      await db.$executeRaw`UPDATE ${T(m)} SET ${C(m, 'reportsToContactId')} = NULL
          WHERE id = ANY(${ids}::uuid[]) AND ${uuidIn(m, 'reportsToContactId', s.contactIds)}`;
    },
  },
  CustomerCommitment: {
    linked: (db, s) =>
      idsWhere(
        db,
        'CustomerCommitment',
        s.orgId,
        uuidIn('CustomerCommitment', 'ownerContactId', s.contactIds),
      ),
    async erase(db, _s, ids) {
      const m = 'CustomerCommitment';
      await db.$executeRaw`UPDATE ${T(m)} SET ${C(m, 'ownerContactId')} = NULL
        WHERE id = ANY(${ids}::uuid[])`;
    },
  },
  OpportunityContact: {
    linked: (db, s) =>
      idsWhere(
        db,
        'OpportunityContact',
        s.orgId,
        uuidIn('OpportunityContact', 'contactId', s.contactIds),
      ),
    async erase(db, _s, ids) {
      await db.$executeRaw`DELETE FROM ${T('OpportunityContact')} WHERE id = ANY(${ids}::uuid[])`;
    },
  },
  MeetingIntelAttendee: {
    linked: meetingAttendeeLinked,
    async erase(db, _s, ids) {
      const m = 'MeetingIntelAttendee';
      await db.$executeRaw`UPDATE ${T(m)} SET ${C(m, 'name')} = ${TOMBSTONE.name},
          ${C(m, 'email')} = NULL, ${C(m, 'title')} = NULL
        WHERE id = ANY(${ids}::uuid[])`;
    },
  },
  MeetingIntel: {
    // A meeting the subject attended: the transcript holds their own words, so
    // it goes. A meeting that only mentions them is redacted in place.
    async linked(db, s) {
      const attended = await meetingAttendeeLinked(db, s, true);
      return idsWhere(
        db,
        'MeetingIntel',
        s.orgId,
        Prisma.sql`id IN (SELECT ${C('MeetingIntelAttendee', 'meetingId')} FROM ${T('MeetingIntelAttendee')}
                           WHERE id = ANY(${attended}::uuid[]))`,
      );
    },
    async erase(db, _s, ids) {
      const m = 'MeetingIntel';
      await db.$executeRaw`UPDATE ${T(m)} SET ${C(m, 'transcriptText')} = NULL
        WHERE id = ANY(${ids}::uuid[])`;
    },
  },
  MeetingIngestItem: { linked: none },
  KamSession: {
    // Attendees are free-text names, so a namesake cannot be told apart: the
    // entry is dropped and the transcript is redacted in place, never wiped.
    linked: (db, s) =>
      idsWhere(
        db,
        'KamSession',
        s.orgId,
        Prisma.sql`EXISTS (SELECT 1 FROM unnest(${C('KamSession', 'attendees')}) a WHERE ${exactEntry(Prisma.sql`a`, s)})`,
      ),
    async erase(db, s, ids) {
      const m = 'KamSession';
      await db.$executeRaw`UPDATE ${T(m)} SET ${C(m, 'attendees')} = ${arrayWithout(m, 'attendees', s)}
        WHERE id = ANY(${ids}::uuid[])`;
    },
  },
  GovernanceMeeting: {
    linked: (db, s) =>
      idsWhere(
        db,
        'GovernanceMeeting',
        s.orgId,
        Prisma.sql`EXISTS (SELECT 1 FROM unnest(${C('GovernanceMeeting', 'participants')}) a WHERE ${exactEntry(Prisma.sql`a`, s)})`,
      ),
    async erase(db, s, ids) {
      const m = 'GovernanceMeeting';
      await db.$executeRaw`UPDATE ${T(m)} SET ${C(m, 'participants')} = ${arrayWithout(m, 'participants', s)}
        WHERE id = ANY(${ids}::uuid[])`;
    },
  },
  CalendarEvent: {
    linked: (db, s) =>
      idsWhere(
        db,
        'CalendarEvent',
        s.orgId,
        Prisma.sql`${lowerIn('CalendarEvent', 'organizerEmail', s.emails)}
          OR ${uuidIn('CalendarEvent', 'relatedEntityId', subjectIds(s))}
          OR ${jsonHasEmail('CalendarEvent', 'attendees', s.emails)}`,
      ),
    async erase(db, s, ids) {
      const m = 'CalendarEvent';
      await db.$executeRaw`UPDATE ${T(m)} SET ${C(m, 'attendees')} = ${jsonWithout(m, 'attendees', s)},
          ${C(m, 'organizerEmail')} = CASE WHEN ${lowerIn(m, 'organizerEmail', s.emails)}
            THEN NULL ELSE ${C(m, 'organizerEmail')} END,
          ${C(m, 'subject')} = CASE WHEN ${uuidIn(m, 'relatedEntityId', subjectIds(s))}
            THEN ${TOMBSTONE.freeText} ELSE ${C(m, 'subject')} END,
          ${C(m, 'bodyPreview')} = CASE WHEN ${uuidIn(m, 'relatedEntityId', subjectIds(s))}
            THEN NULL ELSE ${C(m, 'bodyPreview')} END
        WHERE id = ANY(${ids}::uuid[])`;
    },
  },
  Booking: {
    linked: (db, s) =>
      idsWhere(
        db,
        'Booking',
        s.orgId,
        Prisma.sql`${lowerIn('Booking', 'attendeeEmail', s.emails)}
          OR ${phoneIn('Booking', 'attendeePhone', s.phoneDigits)}`,
      ),
    async erase(db, s, ids) {
      const m = 'Booking';
      await db.$executeRaw`UPDATE ${T(m)} SET ${C(m, 'attendeeName')} = ${TOMBSTONE.name},
          ${C(m, 'attendeeEmail')} = ${tombstoneEmail(s.orgId, s.subjectId)},
          ${C(m, 'attendeePhone')} = NULL, ${C(m, 'answers')} = '{}'::jsonb,
          ${C(m, 'deletedAt')} = coalesce(${C(m, 'deletedAt')}, now())
        WHERE id = ANY(${ids}::uuid[])`;
    },
  },
  EmailMessage: {
    // Mail the subject sent, received or that is filed against them is their
    // correspondence: tombstoned. Mail between other people is only redacted.
    linked: emailMessageLinked,
    async erase(db, s, ids) {
      const m = 'EmailMessage';
      await db.$executeRaw`UPDATE ${T(m)} SET
          ${C(m, 'fromEmail')} = CASE WHEN ${lowerIn(m, 'fromEmail', s.emails)}
            THEN ${tombstoneEmail(s.orgId, s.subjectId)} ELSE ${C(m, 'fromEmail')} END,
          ${C(m, 'toEmails')} = ${jsonWithout(m, 'toEmails', s)},
          ${C(m, 'ccEmails')} = ${jsonWithout(m, 'ccEmails', s)},
          ${C(m, 'subject')} = ${TOMBSTONE.freeText}, ${C(m, 'bodyText')} = NULL, ${C(m, 'bodyHtml')} = NULL,
          ${C(m, 'deletedAt')} = coalesce(${C(m, 'deletedAt')}, now())
        WHERE id = ANY(${ids}::uuid[])`;
    },
  },
  EmailDraft: {
    // An unsent draft to the subject or about them as a contact is never sent: deleted.
    linked: (db, s) =>
      idsWhere(
        db,
        'EmailDraft',
        s.orgId,
        Prisma.sql`${uuidIn('EmailDraft', 'contactId', s.contactIds)}
          OR ${jsonHasEmail('EmailDraft', 'toEmails', s.emails)}
          OR ${jsonHasEmail('EmailDraft', 'ccEmails', s.emails)}`,
      ),
    async erase(db, _s, ids) {
      await db.$executeRaw`DELETE FROM ${T('EmailDraft')} WHERE id = ANY(${ids}::uuid[])`;
    },
  },
  EmailTrackingPixel: {
    async linked(db, s) {
      const messages = await emailMessageLinked(db, s);
      return idsWhere(
        db,
        'EmailTrackingPixel',
        s.orgId,
        uuidIn('EmailTrackingPixel', 'emailMessageId', messages),
      );
    },
    async erase(db, _s, ids) {
      await db.$executeRaw`UPDATE ${T('EmailTrackingPixel')} SET ${C('EmailTrackingPixel', 'firstOpenedIp')} = NULL
                            WHERE id = ANY(${ids}::uuid[])`;
    },
  },
  SmsMessage: {
    linked: (db, s) =>
      idsWhere(
        db,
        'SmsMessage',
        s.orgId,
        Prisma.sql`${phoneIn('SmsMessage', 'toNumber', s.phoneDigits)}
          OR ${phoneIn('SmsMessage', 'fromNumber', s.phoneDigits)}
          OR ${uuidIn('SmsMessage', 'entityId', subjectIds(s))}`,
      ),
    async erase(db, s, ids) {
      const m = 'SmsMessage';
      await db.$executeRaw`UPDATE ${T(m)} SET
          ${C(m, 'toNumber')} = CASE WHEN ${phoneIn(m, 'toNumber', s.phoneDigits)}
            THEN ${TOMBSTONE.phone} ELSE ${C(m, 'toNumber')} END,
          ${C(m, 'fromNumber')} = CASE WHEN ${phoneIn(m, 'fromNumber', s.phoneDigits)}
            THEN ${TOMBSTONE.phone} ELSE ${C(m, 'fromNumber')} END,
          ${C(m, 'body')} = ${TOMBSTONE.freeText},
          ${C(m, 'deletedAt')} = coalesce(${C(m, 'deletedAt')}, now())
        WHERE id = ANY(${ids}::uuid[])`;
    },
  },
  SmsConsent: {
    linked: (db, s) =>
      idsWhere(db, 'SmsConsent', s.orgId, phoneIn('SmsConsent', 'phoneNumber', s.phoneDigits)),
    async erase(db, _s, ids) {
      const m = 'SmsConsent';
      await db.$executeRaw`DELETE FROM ${T(m)} WHERE id = ANY(${ids}::uuid[]) AND NOT ${C(m, 'optedOut')}`;
      const [kept] = await db.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM ${T(m)}
                                                              WHERE id = ANY(${ids}::uuid[])`;
      return Number(kept?.n ?? 0);
    },
  },
  CallSession: {
    linked: callSessionLinked,
    async erase(db, s, ids) {
      const m = 'CallSession';
      await db.$executeRaw`UPDATE ${T(m)} SET ${C(m, 'participantEmails')} = ${jsonWithout(m, 'participantEmails', s)},
          ${C(m, 'transcriptText')} = NULL, ${C(m, 'transcriptStructured')} = NULL,
          ${C(m, 'summary')} = NULL, ${C(m, 'actionItems')} = NULL, ${C(m, 'recordingUrl')} = NULL
        WHERE id = ANY(${ids}::uuid[])`;
    },
  },
  CallSummary: {
    async linked(db, s) {
      const sessions = await callSessionLinked(db, s);
      return idsWhere(db, 'CallSummary', s.orgId, uuidIn('CallSummary', 'callSessionId', sessions));
    },
    async erase(db, _s, ids) {
      await db.$executeRaw`DELETE FROM ${T('CallSummary')} WHERE id = ANY(${ids}::uuid[])`;
    },
  },
  Reference: {
    linked: (db, s) =>
      idsWhere(
        db,
        'Reference',
        s.orgId,
        Prisma.sql`${lowerIn('Reference', 'contactEmail', s.emails)}
          OR (${C('Reference', 'contactEmail')} IS NULL AND ${lowerIn('Reference', 'contactName', s.names)})`,
      ),
    async erase(db, _s, ids) {
      await db.$executeRaw`UPDATE ${T('Reference')} SET ${C('Reference', 'contactName')} = NULL,
          ${C('Reference', 'contactEmail')} = NULL WHERE id = ANY(${ids}::uuid[])`;
    },
  },
  Notification: { linked: none },
  IntelEvidence: { linked: none },
  SignatureRequest: {
    linked: (db, s) =>
      idsWhere(
        db,
        'SignatureRequest',
        s.orgId,
        jsonHasEmail('SignatureRequest', 'recipients', s.emails),
      ),
  },
  SignatureEvent: {
    async linked(db, s) {
      if (!s.emails.length) return [];
      const rows = await db.$queryRaw<Array<{ id: string }>>`
        SELECT e.id::text AS id FROM ${T('SignatureEvent')} e
          JOIN ${T('SignatureRequest')} r ON r.id = e.${C('SignatureEvent', 'signatureRequestId')}
         WHERE r.${C('SignatureRequest', 'orgId')} = ${s.orgId}::uuid
           AND lower(e.${C('SignatureEvent', 'recipientEmail')}) = ANY(${s.emails}::text[])`;
      return rows.map((r) => r.id);
    },
  },
  AuditLog: {
    async linked(db, s) {
      const ids = [s.subjectId, ...subjectIds(s)];
      const rows = await db.$queryRaw<Array<{ id: string }>>`
        SELECT id::text AS id FROM ${T('AuditLog')}
         WHERE ${C('AuditLog', 'orgId')} = ${s.orgId}::uuid AND ${C('AuditLog', 'targetId')} = ANY(${ids}::text[])`;
      return rows.map((r) => r.id);
    },
    rows: (db, ids) =>
      inChunks(ids, (chunk) =>
        db.auditLog.findMany({
          where: { id: { in: chunk.map((id) => BigInt(id)) }, deletedAt: { not: undefined } },
          select: {
            id: true,
            action: true,
            targetType: true,
            targetId: true,
            diff: true,
            at: true,
          },
          take: chunk.length,
        }),
      ),
  },
};

const STORE_FIELDS = new Map<SubjectStoreModel, readonly string[]>(
  SUBJECT_STORES.map((x) => [x.model, x.fields]),
);

/** Replace the subject's identifiers with REDACTED in these fields of these rows. */
async function redactRows(
  db: Db,
  model: SubjectStoreModel,
  s: DataSubject,
  ids: string[],
  fields: readonly string[],
) {
  const re = subjectPattern(s);
  if (!re || !fields.length || !ids.length) return;
  const sets = fields.map((f) => Prisma.sql`${C(model, f)} = ${redactExpr(model, f, re)}`);
  await db.$executeRaw`UPDATE ${T(model)} SET ${Prisma.join(sets, ', ')}
    WHERE id = ANY(${ids}::uuid[]) AND ${anyMatch(model, fields, re)}`;
}

// ─── Subject resolution ──────────────────────────────────────────────────────

function isTombstoneEmail(e: string): boolean {
  return e.endsWith('@erased.invalid');
}

const UNSAFE_TOKEN = /["\\\s]/;

function identity(
  emails: Array<string | null | undefined>,
  phones: Array<string | null | undefined>,
  names: Array<string | null | undefined>,
) {
  const clean = (xs: Array<string | null | undefined>) =>
    xs.map((x) => (x ?? '').trim()).filter((x) => x.length > 0);
  const phoneList = clean(phones).filter((p) => p.replace(/[^0-9]/g, '').length >= 7);
  return {
    emails: clean(emails)
      .map((e) => e.toLowerCase())
      .filter(
        (e) => /^[^@]+@[^@]+\.[^@]+$/.test(e) && !UNSAFE_TOKEN.test(e) && !isTombstoneEmail(e),
      ),
    phones: phoneList.filter((p) => !/["\\]/.test(p)),
    phoneDigits: phoneList.map((p) => p.replace(/[^0-9]/g, '')),
    names: clean(names)
      .map((n) => n.toLowerCase().replace(/\s+/g, ' '))
      .filter(
        (n) =>
          n.length >= 5 &&
          n.split(' ').length >= 2 &&
          !/["\\]/.test(n) &&
          n !== TOMBSTONE.name.toLowerCase(),
      ),
  };
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

/** Resolve a subject and every identifier that can link sidecar rows to them. Null if not in this org. */
export async function resolveDataSubject(
  db: Db,
  orgId: string,
  subjectType: DataSubjectType,
  subjectId: string,
): Promise<DataSubject | null> {
  const contactIds: string[] = [];
  const leadIds: string[] = [];
  const nodeIds: string[] = [];
  const emails: Array<string | null> = [];
  const phones: Array<string | null> = [];
  const names: Array<string | null> = [];

  const addContact = async (id: string): Promise<boolean> => {
    const c = await db.contact.findFirst({
      where: { id, orgId, deletedAt: { not: undefined } },
      select: { id: true, name: true, email: true, phone: true },
    });
    if (!c) return false;
    contactIds.push(c.id);
    emails.push(c.email);
    phones.push(c.phone);
    names.push(c.name);
    return true;
  };

  if (subjectType === 'contact') {
    if (!(await addContact(subjectId))) return null;
  } else if (subjectType === 'lead') {
    const l = await db.lead.findFirst({
      where: { id: subjectId, orgId, deletedAt: { not: undefined } },
      select: { id: true, firstName: true, lastName: true, email: true, phone: true },
    });
    if (!l) return null;
    leadIds.push(l.id);
    emails.push(l.email);
    phones.push(l.phone);
    names.push(`${l.firstName} ${l.lastName}`.trim());
  } else {
    const n = await db.orgChartNode.findFirst({
      where: { id: subjectId, orgId, deletedAt: { not: undefined } },
      select: { id: true, contactId: true },
    });
    if (!n) return null;
    nodeIds.push(n.id);
    if (n.contactId) await addContact(n.contactId);
  }

  // Account people linked to the subject carry their own copy of the details.
  const nodes = await db.orgChartNode.findMany({
    where: {
      orgId,
      deletedAt: { not: undefined },
      OR: [{ id: { in: nodeIds } }, { contactId: { in: contactIds } }],
    },
    select: { id: true, name: true, email: true, phone: true },
    take: 1000,
  });
  for (const n of nodes) {
    nodeIds.push(n.id);
    emails.push(n.email);
    phones.push(n.phone);
    names.push(n.name);
  }

  const ids = identity(emails, phones, names);
  return {
    orgId,
    subjectType,
    subjectId,
    contactIds: uniq(contactIds),
    leadIds: uniq(leadIds),
    nodeIds: uniq(nodeIds),
    emails: uniq(ids.emails),
    phones: uniq(ids.phones),
    phoneDigits: uniq(ids.phoneDigits),
    names: uniq(ids.names),
  };
}

// ─── Export ──────────────────────────────────────────────────────────────────

const SECRET_FIELD = /(hash|encrypted|token|secret)$/i;

function stripSecrets(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([k]) => !SECRET_FIELD.test(k)));
}

async function defaultRows(db: Db, model: string, ids: string[]) {
  const where: Record<string, unknown> = { id: { in: ids } };
  if (hasField(model, 'deletedAt')) where.deletedAt = { not: undefined };
  return inChunks(ids, (chunk) =>
    delegate(db, model).findMany({ where: { ...where, id: { in: chunk } }, take: chunk.length }),
  );
}

/** The API query guard rejects reads above 1000 rows, so id lists are read in slices. */
const READ_CHUNK = 1000;
async function inChunks<T>(ids: string[], read: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += READ_CHUNK)
    out.push(...(await read(ids.slice(i, i + READ_CHUNK))));
  return out;
}

interface StorePlan {
  linked: string[];
  mentioned: string[];
}

async function plan(db: Db, s: DataSubject): Promise<Map<SubjectStoreModel, StorePlan>> {
  const out = new Map<SubjectStoreModel, StorePlan>();
  for (const store of SUBJECT_STORES) {
    const linked = uniq(await HANDLERS[store.model].linked(db, s));
    const linkedSet = new Set(linked);
    const fields = mentionFields(store.model);
    const mentioned =
      fields.length && hasField(store.model, 'orgId')
        ? (
            await idsWhere(
              db,
              store.model,
              s.orgId,
              anyMatch(store.model, fields, subjectPattern(s)),
            )
          ).filter((id) => !linkedSet.has(id))
        : [];
    out.set(store.model, { linked, mentioned });
  }
  return out;
}

/** Which personal fields of other people's records mention the subject. Content is withheld (Art. 15(4)). */
async function mentionSummaries(
  db: Db,
  model: SubjectStoreModel,
  s: DataSubject,
  ids: string[],
): Promise<Array<Record<string, unknown>>> {
  const re = subjectPattern(s);
  const fields = mentionFields(model);
  if (!re || !ids.length || !fields.length) return [];
  const cols = fields.map(
    (f) => Prisma.sql`CASE WHEN ${matches(model, f, re)} THEN ${f}::text END`,
  );
  const rows = await db.$queryRaw<Array<{ id: string; fields: string[] }>>`
    SELECT id::text AS id, array_remove(ARRAY[${Prisma.join(cols, ', ')}], NULL) AS fields
      FROM ${T(model)} WHERE id = ANY(${ids}::uuid[])`;
  return rows.map((r) => ({ id: r.id, mentionedIn: r.fields }));
}

/**
 * Everything held about the subject, per store. Records the subject is linked
 * to are exported in full (personal fields decrypted by the client
 * middleware); records that only mention them list the fields, not the
 * content, because the rest is other people's data.
 */
export async function exportDataSubject(db: Db, s: DataSubject): Promise<DataSubjectBundle> {
  const planned = await plan(db, s);
  const stores: DataSubjectBundle['stores'] = {};
  for (const [model, { linked, mentioned }] of planned) {
    if (!linked.length && !mentioned.length) continue;
    const h = HANDLERS[model];
    const rows = linked.length
      ? h.rows
        ? await h.rows(db, linked)
        : await defaultRows(db, model, linked)
      : [];
    stores[model] = [
      ...rows.map(stripSecrets),
      ...(await mentionSummaries(db, model, s, mentioned)),
    ];
  }
  return {
    subject: { type: s.subjectType, id: s.subjectId },
    generatedAt: new Date().toISOString(),
    stores,
  };
}

/** JSON for an export bundle (BigInt ids and Dates serialised). */
export function serializeDataSubjectBundle(bundle: DataSubjectBundle): string {
  return JSON.stringify(bundle, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v), 2);
}

// ─── Erase ───────────────────────────────────────────────────────────────────

const PRIMARY_MODEL: Record<DataSubjectType, SubjectStoreModel> = {
  contact: 'Contact',
  lead: 'Lead',
  account_person: 'OrgChartNode',
};

/** Fields of the primary subject row that still hold a real value. */
async function primaryScrubbedFields(db: Db, s: DataSubject): Promise<string[]> {
  const where = { id: s.subjectId, orgId: s.orgId, deletedAt: { not: undefined } };
  const tomb = tombstoneEmail(s.orgId, s.subjectId);
  const fields: string[] = [];
  if (s.subjectType === 'contact') {
    const c = await db.contact.findFirst({
      where,
      select: { name: true, email: true, phone: true, role: true },
    });
    if (!c) return [];
    if (c.name !== TOMBSTONE.name) fields.push('name');
    if (c.email !== null && c.email !== tomb) fields.push('email');
    if (c.phone !== null) fields.push('phone');
    if (c.role !== null) fields.push('role');
  } else if (s.subjectType === 'lead') {
    const l = await db.lead.findFirst({
      where,
      select: {
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        title: true,
        notes: true,
        intel: true,
      },
    });
    if (!l) return [];
    if (l.firstName !== TOMBSTONE.name) fields.push('firstName');
    if (l.lastName !== '') fields.push('lastName');
    if (l.email !== null && l.email !== tomb) fields.push('email');
    if (l.phone !== null) fields.push('phone');
    if (l.title !== null) fields.push('title');
    if (l.notes !== null && l.notes !== TOMBSTONE.freeText) fields.push('notes');
    if (l.intel !== null) fields.push('intel');
  } else {
    const n = await db.orgChartNode.findFirst({
      where,
      select: { name: true, email: true, phone: true, linkedinUrl: true },
    });
    if (!n) return [];
    if (n.name !== TOMBSTONE.name) fields.push('name');
    if (n.email !== null) fields.push('email');
    if (n.phone !== null) fields.push('phone');
    if (n.linkedinUrl !== null) fields.push('linkedinUrl');
  }
  return fields;
}

export interface EraseOptions {
  dryRun: boolean;
  actorUserId?: string | null;
  requestId?: string;
}

/**
 * Erase (or, with dryRun, plan the erasure of) a data subject across every
 * subject store, and write the `gdpr.erasure` / `gdpr.erasure.dry_run` audit
 * row. Idempotent: a second run finds nothing left to scrub.
 */
export async function eraseDataSubject(
  db: PrismaClient,
  s: DataSubject,
  opts: EraseOptions,
): Promise<EraseReport> {
  return db.$transaction(
    async (tx) => {
      const scrubbedFields = await primaryScrubbedFields(tx, s);
      const planned = await plan(tx, s);
      const stores: EraseReport['stores'] = {};
      const retained: EraseReport['retained'] = {};
      let auditRowsPseudonymised = 0;

      for (const store of SUBJECT_STORES) {
        const { linked, mentioned } = planned.get(store.model) ?? { linked: [], mentioned: [] };
        if (!linked.length && !mentioned.length) continue;
        const basis = 'basis' in store ? store.basis : undefined;
        if (store.strategy === 'pseudonymise') {
          auditRowsPseudonymised = linked.length;
          continue;
        }
        if (store.strategy === 'retain') {
          retained[store.model] = { rows: linked.length + mentioned.length, basis: basis ?? '' };
          continue;
        }
        let kept = 0;
        if (!opts.dryRun) {
          if (linked.length) kept = (await HANDLERS[store.model].erase?.(tx, s, linked)) ?? 0;
          // A row kept under a legal basis keeps its identifier (that is why it is kept).
          if (!basis) {
            await redactRows(tx, store.model, s, linked, store.fields);
            await redactRows(tx, store.model, s, mentioned, mentionFields(store.model));
          }
        }
        stores[store.model] = {
          action: store.strategy,
          rows: linked.length - kept,
          mentions: mentioned.length,
        };
        if (kept > 0) retained[store.model] = { rows: kept, basis: basis ?? '' };
      }

      const relatedScrubbed = Object.fromEntries(
        Object.entries(stores)
          .filter(([model]) => model !== PRIMARY_MODEL[s.subjectType])
          .map(([model, v]) => [model, v.rows + v.mentions]),
      );
      await tx.auditLog.create({
        data: {
          orgId: s.orgId,
          userId: opts.actorUserId ?? null,
          action: opts.dryRun ? 'gdpr.erasure.dry_run' : 'gdpr.erasure',
          targetType: s.subjectType,
          targetId: s.subjectId,
          diff: {
            subjectType: s.subjectType,
            subjectId: s.subjectId,
            requestId: opts.requestId ?? null,
            scrubbedFields,
            relatedScrubbed,
            retained: Object.fromEntries(Object.entries(retained).map(([m, v]) => [m, v.rows])),
            auditRowsPseudonymised,
          } satisfies Prisma.InputJsonObject,
        },
      });

      return {
        kind: 'erase' as const,
        dryRun: opts.dryRun,
        subjectType: s.subjectType,
        subjectId: s.subjectId,
        scrubbedFields,
        stores,
        retained,
        auditRowsPseudonymised,
      };
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}

// ─── Residue scan ────────────────────────────────────────────────────────────

const RETAINED_MODELS = new Set<string>(
  SUBJECT_STORES.filter((x) => 'basis' in x).map((x) => x.model),
);
const SCAN_SKIP_MODELS = new Set(['DataSubjectRequest']);

function scanColumns(m: SchemaModel): string[] {
  return m.fields
    .filter(
      (f) =>
        f.kind === 'scalar' &&
        (f.type === 'String' || f.type === 'Json') &&
        f.name !== 'id' &&
        !/(Id|Hash)$/.test(f.name) &&
        !(Array.isArray(f.nativeType) && f.nativeType[0] === 'Uuid'),
    )
    .map((f) => f.name);
}

/**
 * Count rows, in every org-scoped table, whose text or JSON columns still
 * contain one of the subject's identifiers. Independent of the handlers: it
 * reads every column, so a store the map missed shows up here. Results carry
 * model and field names only.
 */
export async function scanSubjectResidue(db: Db, s: DataSubject): Promise<ResidueHit[]> {
  const re = subjectPattern(s);
  if (!re) return [];
  const hits: ResidueHit[] = [];
  for (const m of MODELS) {
    if (SCAN_SKIP_MODELS.has(m.name) || !hasField(m.name, 'orgId')) continue;
    const cols = scanColumns(m);
    if (!cols.length) continue;
    // Another person's own name column holding the same name is a namesake,
    // not residue; their email or phone matching the subject still is.
    const idRe = identifierPattern(s);
    const parts = cols.map((f) => {
      const hit = isIdentityField(m.name, f)
        ? Prisma.sql`(${idRe ? matches(m.name, f, idRe) : FALSE}
            OR (id::text = ANY(${subjectIds(s)}::text[]) AND ${matches(m.name, f, re)}))`
        : matches(m.name, f, re);
      return Prisma.sql`SELECT ${f}::text AS field, count(*) AS n FROM ${T(m.name)}
                         WHERE ${C(m.name, 'orgId')} = ${s.orgId}::uuid AND ${hit}`;
    });
    const rows = await db.$queryRaw<Array<{ field: string; n: bigint }>>(
      Prisma.sql`${Prisma.join(parts, ' UNION ALL ')}`,
    );
    for (const r of rows) {
      if (Number(r.n) > 0) {
        hits.push({
          model: m.name,
          field: r.field,
          rows: Number(r.n),
          retained: RETAINED_MODELS.has(m.name),
        });
      }
    }
  }
  return hits;
}

/** Personal fields the detector finds in the live schema (used by evidence scripts). */
export function schemaPersonalFields(): Array<{ model: string; field: string }> {
  return personalFieldsInSchema(MODELS);
}

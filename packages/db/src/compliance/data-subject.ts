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
 * Erasure pseudonymises them instead: they keep only the subject id, which no
 * longer resolves to a person once the subject row is tombstoned.
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
  phones: string[];
  /** Lowercased full names (5 characters or more, to avoid broad matches). */
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
  stores: Record<string, { action: string; rows: number }>;
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
  return (db as unknown as Record<string, { findMany(args: unknown): Promise<Array<Record<string, unknown>>> }>)[
    key
  ]!;
}

// ─── SQL fragments ───────────────────────────────────────────────────────────

const FALSE = Prisma.sql`FALSE`;

function likePatterns(s: DataSubject): string[] {
  return [...s.emails, ...s.phones, ...s.names].map(
    (v) => `%${v.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`,
  );
}

function uuidIn(model: string, field: string, ids: string[]): Prisma.Sql {
  return ids.length ? Prisma.sql`${C(model, field)} = ANY(${ids}::uuid[])` : FALSE;
}

function lowerIn(model: string, field: string, values: string[]): Prisma.Sql {
  return values.length ? Prisma.sql`lower(${C(model, field)}::text) = ANY(${values})` : FALSE;
}

function mentions(model: string, fields: string[], s: DataSubject): Prisma.Sql {
  const p = likePatterns(s);
  if (!p.length) return FALSE;
  return Prisma.join(
    fields.map((f) => Prisma.sql`lower(${C(model, f)}::text) LIKE ANY(${p})`),
    ' OR ',
  );
}

/** A jsonb array column without the elements that mention the subject. */
function jsonWithout(model: string, field: string, s: DataSubject): Prisma.Sql {
  const col = C(model, field);
  const p = likePatterns(s);
  return Prisma.sql`CASE WHEN jsonb_typeof(${col}) = 'array' THEN coalesce((
      SELECT jsonb_agg(e) FROM jsonb_array_elements(${col}) e
       WHERE NOT (lower(e::text) LIKE ANY(${p}))), '[]'::jsonb) ELSE ${col} END`;
}

/** A text[] column without the entries that mention the subject. */
function arrayWithout(model: string, field: string, s: DataSubject): Prisma.Sql {
  const col = C(model, field);
  const p = likePatterns(s);
  return Prisma.sql`array(SELECT x FROM unnest(${col}) x WHERE NOT (lower(x) LIKE ANY(${p})))`;
}

function nullIfMention(model: string, field: string, s: DataSubject): Prisma.Sql {
  const col = C(model, field);
  return Prisma.sql`CASE WHEN lower(${col}::text) LIKE ANY(${likePatterns(s)}) THEN NULL ELSE ${col} END`;
}

async function idsWhere(db: Db, model: string, orgId: string, clause: Prisma.Sql): Promise<string[]> {
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

interface Handler {
  find(db: Db, s: DataSubject): Promise<string[]>;
  /** Apply the erasure to the planned ids. Returns rows kept under a legal basis. */
  erase?(db: Db, s: DataSubject, ids: string[]): Promise<number | void>;
  rows?(db: Db, ids: string[]): Promise<Array<Record<string, unknown>>>;
}

function callSessionIds(db: Db, s: DataSubject): Promise<string[]> {
  return idsWhere(
    db,
    'CallSession',
    s.orgId,
    Prisma.sql`${uuidIn('CallSession', 'entityId', subjectIds(s))}
      OR ${mentions('CallSession', ['participantEmails', 'transcriptText', 'summary'], s)}`,
  );
}

function emailMessageIds(db: Db, s: DataSubject): Promise<string[]> {
  return idsWhere(
    db,
    'EmailMessage',
    s.orgId,
    Prisma.sql`${lowerIn('EmailMessage', 'fromEmail', s.emails)}
      OR ${uuidIn('EmailMessage', 'entityId', subjectIds(s))}
      OR ${mentions('EmailMessage', ['toEmails', 'ccEmails', 'subject', 'bodyText', 'bodyHtml'], s)}`,
  );
}

const HANDLERS: Record<SubjectStoreModel, Handler> = {
  Contact: {
    find: async (_db, s) => s.contactIds,
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
    find: async (_db, s) => s.leadIds,
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
    find: (db, s) =>
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
    find: (db, s) =>
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
    find: (db, s) =>
      idsWhere(
        db,
        'Activity',
        s.orgId,
        Prisma.sql`${uuidIn('Activity', 'entityId', subjectIds(s))}
          OR ${mentions('Activity', ['subject', 'description', 'body', 'metadata'], s)}`,
      ),
    async erase(db, s, ids) {
      const m = 'Activity';
      const linked = subjectIds(s);
      await db.$executeRaw`UPDATE ${T(m)} SET ${C(m, 'subject')} = ${TOMBSTONE.freeText},
          ${C(m, 'description')} = NULL, ${C(m, 'body')} = '{}'::jsonb, ${C(m, 'metadata')} = '{}'::jsonb,
          ${C(m, 'deletedAt')} = CASE WHEN ${uuidIn(m, 'entityId', linked)}
            THEN coalesce(${C(m, 'deletedAt')}, now()) ELSE ${C(m, 'deletedAt')} END
        WHERE id = ANY(${ids}::uuid[])`;
    },
  },
  ContactFact: {
    find: (db, s) =>
      idsWhere(
        db,
        'ContactFact',
        s.orgId,
        Prisma.sql`${uuidIn('ContactFact', 'contactId', s.contactIds)}
          OR ${uuidIn('ContactFact', 'reportsToContactId', s.contactIds)}
          OR ${mentions('ContactFact', ['claim', 'evidenceDetail'], s)}`,
      ),
    async erase(db, s, ids) {
      const m = 'ContactFact';
      await db.$executeRaw`DELETE FROM ${T(m)} WHERE id = ANY(${ids}::uuid[])
          AND (${uuidIn(m, 'contactId', s.contactIds)} OR ${mentions(m, ['claim', 'evidenceDetail'], s)})`;
      await db.$executeRaw`UPDATE ${T(m)} SET ${C(m, 'reportsToContactId')} = NULL
          WHERE id = ANY(${ids}::uuid[]) AND ${uuidIn(m, 'reportsToContactId', s.contactIds)}`;
    },
  },
  CustomerCommitment: {
    find: (db, s) =>
      idsWhere(
        db,
        'CustomerCommitment',
        s.orgId,
        Prisma.sql`${uuidIn('CustomerCommitment', 'ownerContactId', s.contactIds)}
          OR ${mentions('CustomerCommitment', ['promise', 'sourceNote'], s)}`,
      ),
    async erase(db, s, ids) {
      const m = 'CustomerCommitment';
      await db.$executeRaw`UPDATE ${T(m)} SET
          ${C(m, 'ownerContactId')} = CASE WHEN ${uuidIn(m, 'ownerContactId', s.contactIds)}
            THEN NULL ELSE ${C(m, 'ownerContactId')} END,
          ${C(m, 'promise')} = CASE WHEN ${mentions(m, ['promise'], s)}
            THEN ${TOMBSTONE.freeText} ELSE ${C(m, 'promise')} END,
          ${C(m, 'sourceNote')} = ${nullIfMention(m, 'sourceNote', s)}
        WHERE id = ANY(${ids}::uuid[])`;
    },
  },
  OpportunityContact: {
    find: (db, s) =>
      idsWhere(
        db,
        'OpportunityContact',
        s.orgId,
        Prisma.sql`${uuidIn('OpportunityContact', 'contactId', s.contactIds)}
          OR ${mentions('OpportunityContact', ['notes'], s)}`,
      ),
    async erase(db, _s, ids) {
      await db.$executeRaw`DELETE FROM ${T('OpportunityContact')} WHERE id = ANY(${ids}::uuid[])`;
    },
  },
  MeetingIntelAttendee: {
    find: (db, s) =>
      idsWhere(
        db,
        'MeetingIntelAttendee',
        s.orgId,
        Prisma.sql`${uuidIn('MeetingIntelAttendee', 'contactId', s.contactIds)}
          OR ${lowerIn('MeetingIntelAttendee', 'email', s.emails)}
          OR ${lowerIn('MeetingIntelAttendee', 'name', s.names)}`,
      ),
    async erase(db, _s, ids) {
      const m = 'MeetingIntelAttendee';
      await db.$executeRaw`UPDATE ${T(m)} SET ${C(m, 'name')} = ${TOMBSTONE.name},
          ${C(m, 'email')} = NULL, ${C(m, 'title')} = NULL
        WHERE id = ANY(${ids}::uuid[])`;
    },
  },
  MeetingIntel: {
    async find(db, s) {
      const attended = await HANDLERS.MeetingIntelAttendee.find(db, s);
      return idsWhere(
        db,
        'MeetingIntel',
        s.orgId,
        Prisma.sql`id IN (SELECT ${C('MeetingIntelAttendee', 'meetingId')} FROM ${T('MeetingIntelAttendee')}
                           WHERE id = ANY(${attended}::uuid[]))
          OR ${mentions('MeetingIntel', ['transcriptText', 'summary'], s)}`,
      );
    },
    async erase(db, s, ids) {
      const m = 'MeetingIntel';
      await db.$executeRaw`UPDATE ${T(m)} SET ${C(m, 'transcriptText')} = NULL,
          ${C(m, 'summary')} = ${nullIfMention(m, 'summary', s)}
        WHERE id = ANY(${ids}::uuid[])`;
    },
  },
  MeetingIngestItem: {
    find: (db, s) =>
      idsWhere(db, 'MeetingIngestItem', s.orgId, mentions('MeetingIngestItem', ['payload'], s)),
    async erase(db, _s, ids) {
      await db.$executeRaw`DELETE FROM ${T('MeetingIngestItem')} WHERE id = ANY(${ids}::uuid[])`;
    },
  },
  KamSession: {
    find: (db, s) =>
      idsWhere(
        db,
        'KamSession',
        s.orgId,
        mentions('KamSession', ['attendees', 'transcriptText', 'transcriptStructured', 'aiNote'], s),
      ),
    async erase(db, s, ids) {
      const m = 'KamSession';
      await db.$executeRaw`UPDATE ${T(m)} SET ${C(m, 'attendees')} = ${arrayWithout(m, 'attendees', s)},
          ${C(m, 'transcriptText')} = NULL, ${C(m, 'transcriptStructured')} = NULL,
          ${C(m, 'aiNote')} = ${nullIfMention(m, 'aiNote', s)}
        WHERE id = ANY(${ids}::uuid[])`;
    },
  },
  GovernanceMeeting: {
    find: (db, s) =>
      idsWhere(db, 'GovernanceMeeting', s.orgId, mentions('GovernanceMeeting', ['participants', 'outcomes'], s)),
    async erase(db, s, ids) {
      const m = 'GovernanceMeeting';
      await db.$executeRaw`UPDATE ${T(m)} SET ${C(m, 'participants')} = ${arrayWithout(m, 'participants', s)},
          ${C(m, 'outcomes')} = ${nullIfMention(m, 'outcomes', s)}
        WHERE id = ANY(${ids}::uuid[])`;
    },
  },
  CalendarEvent: {
    find: (db, s) =>
      idsWhere(
        db,
        'CalendarEvent',
        s.orgId,
        Prisma.sql`${lowerIn('CalendarEvent', 'organizerEmail', s.emails)}
          OR ${uuidIn('CalendarEvent', 'relatedEntityId', subjectIds(s))}
          OR ${mentions('CalendarEvent', ['attendees', 'subject', 'bodyPreview'], s)}`,
      ),
    async erase(db, s, ids) {
      const m = 'CalendarEvent';
      const about = Prisma.sql`(${uuidIn(m, 'relatedEntityId', subjectIds(s))}
        OR ${mentions(m, ['subject', 'bodyPreview'], s)})`;
      await db.$executeRaw`UPDATE ${T(m)} SET ${C(m, 'attendees')} = ${jsonWithout(m, 'attendees', s)},
          ${C(m, 'organizerEmail')} = CASE WHEN ${lowerIn(m, 'organizerEmail', s.emails)}
            THEN NULL ELSE ${C(m, 'organizerEmail')} END,
          ${C(m, 'subject')} = CASE WHEN ${about} THEN ${TOMBSTONE.freeText} ELSE ${C(m, 'subject')} END,
          ${C(m, 'bodyPreview')} = CASE WHEN ${about} THEN NULL ELSE ${C(m, 'bodyPreview')} END
        WHERE id = ANY(${ids}::uuid[])`;
    },
  },
  Booking: {
    find: (db, s) =>
      idsWhere(
        db,
        'Booking',
        s.orgId,
        Prisma.sql`${lowerIn('Booking', 'attendeeEmail', s.emails)}
          OR ${s.phones.length ? Prisma.sql`${C('Booking', 'attendeePhone')} = ANY(${s.phones})` : FALSE}`,
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
    find: emailMessageIds,
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
  EmailTrackingPixel: {
    async find(db, s) {
      const messages = await emailMessageIds(db, s);
      return idsWhere(db, 'EmailTrackingPixel', s.orgId, uuidIn('EmailTrackingPixel', 'emailMessageId', messages));
    },
    async erase(db, _s, ids) {
      await db.$executeRaw`UPDATE ${T('EmailTrackingPixel')} SET ${C('EmailTrackingPixel', 'firstOpenedIp')} = NULL
                            WHERE id = ANY(${ids}::uuid[])`;
    },
  },
  SmsMessage: {
    find: (db, s) =>
      idsWhere(
        db,
        'SmsMessage',
        s.orgId,
        Prisma.sql`${s.phones.length ? Prisma.sql`${C('SmsMessage', 'toNumber')} = ANY(${s.phones}) OR ${C('SmsMessage', 'fromNumber')} = ANY(${s.phones})` : FALSE}
          OR ${uuidIn('SmsMessage', 'entityId', subjectIds(s))}
          OR ${mentions('SmsMessage', ['body'], s)}`,
      ),
    async erase(db, s, ids) {
      const m = 'SmsMessage';
      await db.$executeRaw`UPDATE ${T(m)} SET
          ${C(m, 'toNumber')} = CASE WHEN ${C(m, 'toNumber')} = ANY(${s.phones}) THEN ${TOMBSTONE.phone} ELSE ${C(m, 'toNumber')} END,
          ${C(m, 'fromNumber')} = CASE WHEN ${C(m, 'fromNumber')} = ANY(${s.phones}) THEN ${TOMBSTONE.phone} ELSE ${C(m, 'fromNumber')} END,
          ${C(m, 'body')} = ${TOMBSTONE.freeText},
          ${C(m, 'deletedAt')} = coalesce(${C(m, 'deletedAt')}, now())
        WHERE id = ANY(${ids}::uuid[])`;
    },
  },
  SmsConsent: {
    find: (db, s) =>
      s.phones.length
        ? idsWhere(db, 'SmsConsent', s.orgId, Prisma.sql`${C('SmsConsent', 'phoneNumber')} = ANY(${s.phones})`)
        : Promise.resolve([]),
    async erase(db, _s, ids) {
      const m = 'SmsConsent';
      await db.$executeRaw`DELETE FROM ${T(m)} WHERE id = ANY(${ids}::uuid[]) AND NOT ${C(m, 'optedOut')}`;
      const [kept] = await db.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM ${T(m)}
                                                              WHERE id = ANY(${ids}::uuid[])`;
      return Number(kept?.n ?? 0);
    },
  },
  CallSession: {
    find: callSessionIds,
    async erase(db, s, ids) {
      const m = 'CallSession';
      await db.$executeRaw`UPDATE ${T(m)} SET ${C(m, 'participantEmails')} = ${jsonWithout(m, 'participantEmails', s)},
          ${C(m, 'transcriptText')} = NULL, ${C(m, 'transcriptStructured')} = NULL,
          ${C(m, 'summary')} = NULL, ${C(m, 'actionItems')} = NULL, ${C(m, 'recordingUrl')} = NULL
        WHERE id = ANY(${ids}::uuid[])`;
    },
  },
  CallSummary: {
    async find(db, s) {
      const sessions = await callSessionIds(db, s);
      return idsWhere(db, 'CallSummary', s.orgId, uuidIn('CallSummary', 'callSessionId', sessions));
    },
    async erase(db, _s, ids) {
      await db.$executeRaw`DELETE FROM ${T('CallSummary')} WHERE id = ANY(${ids}::uuid[])`;
    },
  },
  Reference: {
    find: (db, s) =>
      idsWhere(
        db,
        'Reference',
        s.orgId,
        Prisma.sql`${lowerIn('Reference', 'contactEmail', s.emails)} OR ${lowerIn('Reference', 'contactName', s.names)}`,
      ),
    async erase(db, _s, ids) {
      await db.$executeRaw`UPDATE ${T('Reference')} SET ${C('Reference', 'contactName')} = NULL,
          ${C('Reference', 'contactEmail')} = NULL WHERE id = ANY(${ids}::uuid[])`;
    },
  },
  Notification: {
    find: (db, s) => idsWhere(db, 'Notification', s.orgId, mentions('Notification', ['title', 'body'], s)),
    async erase(db, _s, ids) {
      await db.$executeRaw`DELETE FROM ${T('Notification')} WHERE id = ANY(${ids}::uuid[])`;
    },
  },
  IntelEvidence: {
    find: (db, s) => idsWhere(db, 'IntelEvidence', s.orgId, mentions('IntelEvidence', ['excerpt', 'label'], s)),
    async erase(db, _s, ids) {
      await db.$executeRaw`DELETE FROM ${T('IntelEvidence')} WHERE id = ANY(${ids}::uuid[])`;
    },
  },
  SignatureRequest: {
    find: (db, s) => idsWhere(db, 'SignatureRequest', s.orgId, mentions('SignatureRequest', ['recipients'], s)),
  },
  SignatureEvent: {
    async find(db, s) {
      if (!s.emails.length) return [];
      const rows = await db.$queryRaw<Array<{ id: string }>>`
        SELECT e.id::text AS id FROM ${T('SignatureEvent')} e
          JOIN ${T('SignatureRequest')} r ON r.id = e.${C('SignatureEvent', 'signatureRequestId')}
         WHERE r.${C('SignatureRequest', 'orgId')} = ${s.orgId}::uuid
           AND lower(e.${C('SignatureEvent', 'recipientEmail')}) = ANY(${s.emails})`;
      return rows.map((r) => r.id);
    },
  },
  AuditLog: {
    async find(db, s) {
      const ids = [s.subjectId, ...subjectIds(s)];
      const rows = await db.$queryRaw<Array<{ id: string }>>`
        SELECT id::text AS id FROM ${T('AuditLog')}
         WHERE ${C('AuditLog', 'orgId')} = ${s.orgId}::uuid AND ${C('AuditLog', 'targetId')} = ANY(${ids})`;
      return rows.map((r) => r.id);
    },
    rows: (db, ids) =>
      inChunks(ids, (chunk) =>
        db.auditLog.findMany({
          where: { id: { in: chunk.map((id) => BigInt(id)) }, deletedAt: { not: undefined } },
          select: { id: true, action: true, targetType: true, targetId: true, diff: true, at: true },
          take: chunk.length,
        }),
      ),
  },
};

// ─── Subject resolution ──────────────────────────────────────────────────────

function isTombstoneEmail(e: string): boolean {
  return e.endsWith('@erased.invalid');
}

function identity(
  emails: Array<string | null | undefined>,
  phones: Array<string | null | undefined>,
  names: Array<string | null | undefined>,
) {
  const clean = (xs: Array<string | null | undefined>) =>
    xs.map((x) => (x ?? '').trim()).filter((x) => x.length > 0);
  return {
    emails: clean(emails).map((e) => e.toLowerCase()).filter((e) => !isTombstoneEmail(e)),
    phones: clean(phones).filter((p) => p !== TOMBSTONE.phone),
    names: clean(names)
      .map((n) => n.toLowerCase())
      .filter((n) => n.length >= 5 && n !== TOMBSTONE.name.toLowerCase()),
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
  for (let i = 0; i < ids.length; i += READ_CHUNK) out.push(...(await read(ids.slice(i, i + READ_CHUNK))));
  return out;
}

async function plan(db: Db, s: DataSubject): Promise<Map<SubjectStoreModel, string[]>> {
  const out = new Map<SubjectStoreModel, string[]>();
  for (const store of SUBJECT_STORES) {
    out.set(store.model, uniq(await HANDLERS[store.model].find(db, s)));
  }
  return out;
}

/** Everything held about the subject, per store. Personal fields are decrypted by the client middleware. */
export async function exportDataSubject(db: Db, s: DataSubject): Promise<DataSubjectBundle> {
  const planned = await plan(db, s);
  const stores: DataSubjectBundle['stores'] = {};
  for (const [model, ids] of planned) {
    if (!ids.length) continue;
    const h = HANDLERS[model];
    const rows = h.rows ? await h.rows(db, ids) : await defaultRows(db, model, ids);
    stores[model] = rows.map(stripSecrets);
  }
  return {
    subject: { type: s.subjectType, id: s.subjectId },
    generatedAt: new Date().toISOString(),
    stores,
  };
}

/** JSON for an export bundle (BigInt ids and Dates serialised). */
export function serializeDataSubjectBundle(bundle: DataSubjectBundle): string {
  return JSON.stringify(
    bundle,
    (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v),
    2,
  );
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
    const c = await db.contact.findFirst({ where, select: { name: true, email: true, phone: true, role: true } });
    if (!c) return [];
    if (c.name !== TOMBSTONE.name) fields.push('name');
    if (c.email !== null && c.email !== tomb) fields.push('email');
    if (c.phone !== null) fields.push('phone');
    if (c.role !== null) fields.push('role');
  } else if (s.subjectType === 'lead') {
    const l = await db.lead.findFirst({
      where,
      select: { firstName: true, lastName: true, email: true, phone: true, title: true, notes: true, intel: true },
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
        const ids = planned.get(store.model) ?? [];
        if (!ids.length) continue;
        const basis = 'basis' in store ? store.basis : undefined;
        if (store.strategy === 'pseudonymise') {
          auditRowsPseudonymised = ids.length;
          continue;
        }
        if (store.strategy === 'retain') {
          retained[store.model] = { rows: ids.length, basis: basis ?? '' };
          continue;
        }
        let kept = 0;
        if (!opts.dryRun) kept = (await HANDLERS[store.model].erase?.(tx, s, ids)) ?? 0;
        stores[store.model] = { action: store.strategy, rows: ids.length - kept };
        if (kept > 0) retained[store.model] = { rows: kept, basis: basis ?? '' };
      }

      const relatedScrubbed = Object.fromEntries(
        Object.entries(stores)
          .filter(([model]) => model !== PRIMARY_MODEL[s.subjectType])
          .map(([model, v]) => [model, v.rows]),
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
  const p = likePatterns(s);
  if (!p.length) return [];
  const hits: ResidueHit[] = [];
  for (const m of MODELS) {
    if (SCAN_SKIP_MODELS.has(m.name) || !hasField(m.name, 'orgId')) continue;
    const cols = scanColumns(m);
    if (!cols.length) continue;
    const parts = cols.map(
      (f) => Prisma.sql`SELECT ${f}::text AS field, count(*) AS n FROM ${T(m.name)}
                         WHERE ${C(m.name, 'orgId')} = ${s.orgId}::uuid
                           AND lower(${C(m.name, f)}::text) LIKE ANY(${p})`,
    );
    const rows = await db.$queryRaw<Array<{ field: string; n: bigint }>>(
      Prisma.sql`${Prisma.join(parts, ' UNION ALL ')}`,
    );
    for (const r of rows) {
      if (Number(r.n) > 0) {
        hits.push({ model: m.name, field: r.field, rows: Number(r.n), retained: RETAINED_MODELS.has(m.name) });
      }
    }
  }
  return hits;
}

/** Personal fields the detector finds in the live schema (used by evidence scripts). */
export function schemaPersonalFields(): Array<{ model: string; field: string }> {
  return personalFieldsInSchema(MODELS);
}

// Synced meetings and emails become account activities.
//
// The provider pulls file a CalendarEvent or EmailMessage to a contact, account
// and maybe an opportunity (apps/worker lib/comms-capture.ts). This bridge turns
// a filed record into one Activity so the account timeline and activity charts
// see it, with ActivityAttendee rows for the people on it.
//
// Rules:
// - One activity per provider item: Activity.idempotencyKey folds org,
//   provider, kind and provider id (same pattern as activity-ingest).
// - Only external conversations: an item whose participants are all on org
//   user domains (or are org users) is skipped. Private items are skipped.
// - Declined or cancelled meetings never create an activity; an existing one
//   is set to cancelled. Private beats cancelled: a private meeting is
//   suppressed even when it is also cancelled or declined, and the privacy
//   flag is stored on a hidden activity so a later sync without hints cannot
//   publish the subject or participants. An item that stops qualifying
//   (unfiled, private, internal only, deleted email) soft-deletes its
//   activity with removedBy "sync", so it can come back if the item qualifies
//   again. A row a person deleted stays deleted.
// - Refiling moves the activity: opportunity when there is one, else the
//   account. Several open opportunities and none picked: account only, with
//   needsOpportunity set rather than a guess.
// - No message bodies: subject, times, direction, participant count and a
//   link back to the source record.

import { createHash } from 'node:crypto';

import {
  FREE_MAIL_DOMAINS,
  commsSourceFor,
  type CommsSource,
  type MeetingChannel,
} from '@bidstack/shared';

import type { Prisma, PrismaClient } from '../../generated/client/index.js';
import { prisma } from '../index.js';

import { onAccountActivityCreated } from './account-activity-events.js';

export type CommsBridgeDb = Pick<
  PrismaClient,
  'calendarEvent' | 'emailMessage' | 'activity' | 'activityAttendee' | 'contact' | 'user' | 'opportunity' | '$transaction'
>;

/** Provider facts the CalendarEvent row has no column for. */
export interface MeetingHints {
  channel?: MeetingChannel;
  isPrivate?: boolean;
  ownerDeclined?: boolean;
}

/** Stored on Activity.metadata.commsCapture. */
export interface CommsCaptureMeta {
  version: 1;
  kind: 'meeting' | 'email';
  provider: string;
  source: CommsSource;
  channel: MeetingChannel | null;
  sourceType: 'calendar_event' | 'email_message';
  sourceId: string;
  ownerUserId: string;
  companyId: string | null;
  opportunityId: string | null;
  contactId: string | null;
  filedManually: boolean;
  needsOpportunity: boolean;
  direction: 'inbound' | 'outbound' | null;
  participantCount: number;
  isPrivate: boolean;
  ownerDeclined: boolean;
  removedBy?: 'sync';
}

export type CommsSkipReason =
  | 'not_found'
  | 'no_external_id'
  | 'not_filed'
  | 'internal_only'
  | 'private'
  | 'declined'
  | 'cancelled'
  | 'other_owner'
  | 'concurrent'
  | 'deleted_by_user';

export type CommsBridgeResult =
  | { action: 'created' | 'updated' | 'cancelled' | 'removed'; activityId: string }
  | { action: 'skipped'; reason: CommsSkipReason; activityId: string | null };

const KEY_PREFIX = 'comms:';
const MAX_PARTICIPANTS = 200;
const DIRECTORY_TTL_MS = 5 * 60 * 1000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Org-scoped dedupe key stored in Activity.idempotencyKey (VarChar 128). */
export function commsActivityKey(
  orgId: string,
  provider: string,
  kind: 'meeting' | 'email',
  externalId: string,
): string {
  const digest = createHash('sha256')
    .update(`${orgId}\u0000${provider}\u0000${kind}\u0000${externalId}`)
    .digest('hex');
  return `${KEY_PREFIX}${digest}`;
}

const domainOf = (email: string) => email.slice(email.lastIndexOf('@') + 1);

interface Directory {
  /** Org user email (lower case) to user id. */
  users: Map<string, string>;
  /** User id to their primary email (lower case). */
  emailOf: Map<string, string>;
  /** Org user domains, consumer mail domains excluded. */
  domains: Set<string>;
}

interface Normalized {
  orgId: string;
  kind: 'meeting' | 'email';
  provider: 'microsoft_graph' | 'google_workspace' | 'OUTLOOK' | 'GMAIL';
  externalId: string;
  sourceType: 'calendar_event' | 'email_message';
  sourceId: string;
  ownerUserId: string;
  subject: string;
  occurredAt: Date;
  endAt: Date | null;
  /** Lower-cased, deduped. */
  participants: string[];
  responses: Map<string, string>;
  cancelled: boolean;
  gone: boolean;
  companyId: string | null;
  opportunityId: string | null;
  contactId: string | null;
  filedManually: boolean;
  direction: 'inbound' | 'outbound' | null;
  hints: MeetingHints;
  /** Calendar identity shared by every attendee's copy; one activity per identity. */
  identity?: string;
  /** Per-copy keys written before the identity was stored. */
  legacyKeys?: string[];
}

function cleanParticipants(raw: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const value of raw) {
    const email = (value ?? '').trim().toLowerCase();
    if (!EMAIL.test(email) || out.includes(email)) continue;
    out.push(email);
    if (out.length >= MAX_PARTICIPANTS) break;
  }
  return out;
}

function emailsOf(json: unknown): Array<{ email: string; responseStatus?: string }> {
  if (!Array.isArray(json)) return [];
  return json.flatMap((v) =>
    v && typeof v === 'object' && typeof (v as { email?: unknown }).email === 'string'
      ? [v as { email: string; responseStatus?: string }]
      : [],
  );
}

/** Provider response words to the ActivityAttendee vocabulary. */
function responseOf(raw: string | undefined): string {
  switch ((raw ?? '').toLowerCase()) {
    case 'accepted':
    case 'organizer':
      return 'accepted';
    case 'declined':
      return 'declined';
    case 'tentative':
    case 'tentativelyaccepted':
      return 'tentative';
    default:
      return 'needs_action';
  }
}

function storedMeta(metadata: unknown): CommsCaptureMeta | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const meta = (metadata as { commsCapture?: unknown }).commsCapture;
  return meta && typeof meta === 'object' ? (meta as CommsCaptureMeta) : null;
}

export function createCommsActivityBridge(db: CommsBridgeDb = prisma as unknown as CommsBridgeDb) {
  const directories = new Map<string, { at: number; dir: Promise<Directory> }>();

  function directory(orgId: string): Promise<Directory> {
    const hit = directories.get(orgId);
    if (hit && Date.now() - hit.at < DIRECTORY_TTL_MS) return hit.dir;
    const dir = db.user
      .findMany({
        where: { orgId },
        select: { id: true, email: true, microsoftEmail: true },
        orderBy: { id: 'asc' },
        take: 1000,
      })
      .then((rows) => {
        const users = new Map<string, string>();
        const emailOf = new Map<string, string>();
        const domains = new Set<string>();
        for (const row of rows) {
          for (const raw of [row.email, row.microsoftEmail]) {
            const email = (raw ?? '').trim().toLowerCase();
            if (!EMAIL.test(email)) continue;
            users.set(email, row.id);
            if (!emailOf.has(row.id)) emailOf.set(row.id, email);
            const domain = domainOf(email);
            if (!FREE_MAIL_DOMAINS.has(domain)) domains.add(domain);
          }
        }
        return { users, emailOf, domains };
      });
    directories.set(orgId, { at: Date.now(), dir });
    dir.catch(() => directories.delete(orgId));
    return dir;
  }

  async function needsOpportunity(orgId: string, companyId: string): Promise<boolean> {
    const open = await db.opportunity.findMany({
      where: { orgId, companyId, deletedAt: null, stage: { notIn: ['closed_won', 'closed_lost'] } },
      select: { id: true },
      take: 2,
    });
    return open.length > 1;
  }

  /**
   * Move a per-copy activity written before the shared identity was stored onto
   * the identity key, so the upgrade does not show the meeting twice.
   */
  async function adoptLegacy(orgId: string, key: string, legacyKeys: string[], sourceId: string): Promise<void> {
    if (!legacyKeys.length) return;
    const existing =
      (await db.activity.findFirst({ where: { orgId, idempotencyKey: key }, select: { id: true } })) ??
      (await db.activity.findFirst({
        where: { orgId, idempotencyKey: key, deletedAt: { not: null } },
        select: { id: true },
      }));
    if (existing) return;
    const live = await db.activity.findMany({
      where: { orgId, idempotencyKey: { in: legacyKeys } },
      select: { id: true, metadata: true },
      take: legacyKeys.length,
    });
    let keeper: { id: string; metadata: unknown } | undefined;
    let deleted = false;
    if (live.length) {
      keeper = live.find((a) => storedMeta(a.metadata)?.sourceId === sourceId) ?? live[0];
    } else {
      const tombs = await db.activity.findMany({
        where: { orgId, idempotencyKey: { in: legacyKeys }, deletedAt: { not: null } },
        select: { id: true, metadata: true },
        take: legacyKeys.length,
      });
      // A person's delete outranks a sync tomb.
      keeper = tombs.find((a) => storedMeta(a.metadata)?.removedBy !== 'sync') ?? tombs[0];
      deleted = true;
    }
    if (!keeper) return;
    try {
      await db.$transaction(async (tx) => {
        await tx.activity.updateMany({
          where: { id: keeper.id, orgId, ...(deleted ? { deletedAt: { not: null } } : {}) },
          data: { idempotencyKey: key },
        });
        for (const extra of live) {
          if (extra.id === keeper.id) continue;
          await tx.activity.updateMany({
            where: { id: extra.id, orgId },
            data: {
              deletedAt: new Date(),
              metadata: { commsCapture: { ...storedMeta(extra.metadata), removedBy: 'sync' } } as Prisma.InputJsonObject,
            },
          });
        }
      });
    } catch (err) {
      // Another copy adopted it first.
      if ((err as { code?: string }).code !== 'P2002') throw err;
    }
  }

  async function sync(n: Normalized, actorUserId: string | null): Promise<CommsBridgeResult> {
    const { orgId } = n;
    const key = n.identity
      ? commsActivityKey(orgId, 'ical', n.kind, n.identity)
      : commsActivityKey(orgId, n.provider, n.kind, n.externalId);
    if (n.identity) await adoptLegacy(orgId, key, n.legacyKeys ?? [], n.sourceId);
    const live = await db.activity.findFirst({
      where: { orgId, idempotencyKey: key },
      select: { id: true, metadata: true, status: true },
    });
    const tomb = live
      ? null
      : await db.activity.findFirst({
          where: { orgId, idempotencyKey: key, deletedAt: { not: null } },
          select: { id: true, metadata: true },
        });
    const prior = storedMeta((live ?? tomb)?.metadata);
    // Copies sharing an identity take turns as the source; without one, the first copy owns it.
    if (prior && !n.identity && prior.sourceId !== n.sourceId) {
      return { action: 'skipped', reason: 'other_owner', activityId: (live ?? tomb)?.id ?? null };
    }

    const hints: Required<MeetingHints> = {
      channel: n.hints.channel ?? prior?.channel ?? 'in_person_or_other',
      // A missing hint must not forget a privacy flag stored on an earlier pull.
      isPrivate: n.hints.isPrivate ?? prior?.isPrivate ?? false,
      ownerDeclined: n.hints.ownerDeclined ?? prior?.ownerDeclined ?? false,
    };
    const channel = n.kind === 'meeting' ? hints.channel : null;

    const remove = async (reason: CommsSkipReason): Promise<CommsBridgeResult> => {
      if (!live) return { action: 'skipped', reason, activityId: tomb?.id ?? null };
      await db.activity.updateMany({
        where: { id: live.id, orgId },
        data: {
          deletedAt: new Date(),
          metadata: { commsCapture: { ...prior, removedBy: 'sync' } } as Prisma.InputJsonObject,
        },
      });
      return { action: 'removed', activityId: live.id };
    };

    // Privacy is decided before cancellation. A cancelled private meeting would
    // otherwise stay on the account page, because cancelled rows are listed.
    if (hints.isPrivate) {
      // Only a tomb this sync wrote (removedBy "sync") may be updated or
      // restored. A legacy row, a person delete, or metadata we cannot read
      // stays deleted and is never stamped as a sync tomb.
      const syncOwnedTomb = Boolean(tomb && prior?.removedBy === 'sync');
      if (tomb && !syncOwnedTomb) {
        return { action: 'skipped', reason: 'deleted_by_user', activityId: tomb.id };
      }
      const hidden: CommsCaptureMeta = {
        version: 1,
        kind: n.kind,
        provider: n.provider,
        source: prior?.source ?? commsSourceFor(n.provider, channel),
        channel,
        sourceType: n.sourceType,
        sourceId: n.sourceId,
        ownerUserId: n.ownerUserId,
        companyId: n.companyId,
        opportunityId: n.opportunityId,
        contactId: n.contactId,
        filedManually: n.filedManually,
        needsOpportunity: false,
        direction: n.direction,
        participantCount: 0,
        isPrivate: true,
        ownerDeclined: hints.ownerDeclined,
        removedBy: 'sync',
      };
      const hiddenData = {
        subject: null,
        description: null,
        metadata: { commsCapture: hidden } as unknown as Prisma.InputJsonObject,
      };
      if (live) {
        await db.$transaction(async (tx) => {
          await tx.activity.updateMany({
            where: { id: live.id, orgId },
            data: { ...hiddenData, deletedAt: new Date() },
          });
          await tx.activityAttendee.deleteMany({ where: { orgId, activityId: live.id } });
        });
        return { action: 'removed', activityId: live.id };
      }
      if (tomb) {
        await db.activity.updateMany({
          where: { id: tomb.id, orgId, deletedAt: { not: null } },
          data: hiddenData,
        });
        return { action: 'skipped', reason: 'private', activityId: tomb.id };
      }
      try {
        const created = await db.activity.create({
          data: {
            orgId,
            idempotencyKey: key,
            type: n.kind,
            status: 'cancelled',
            entityType: n.opportunityId ? 'opportunity' : 'company',
            entityId: n.opportunityId ?? n.companyId ?? n.sourceId,
            ownerId: n.ownerUserId,
            actorId: null,
            actorType: 'system',
            occurredAt: n.occurredAt,
            deletedAt: new Date(),
            ...hiddenData,
          },
          select: { id: true },
        });
        return { action: 'skipped', reason: 'private', activityId: created.id };
      } catch (err) {
        if ((err as { code?: string }).code === 'P2002') {
          return { action: 'skipped', reason: 'concurrent', activityId: null };
        }
        throw err;
      }
    }

    if (n.kind === 'meeting' && (n.gone || n.cancelled || hints.ownerDeclined)) {
      const reason: CommsSkipReason = hints.ownerDeclined && !n.gone && !n.cancelled ? 'declined' : 'cancelled';
      if (!live) return { action: 'skipped', reason, activityId: tomb?.id ?? null };
      await db.activity.updateMany({
        where: { id: live.id, orgId },
        data: {
          status: 'cancelled',
          metadata: { commsCapture: { ...prior, ownerDeclined: hints.ownerDeclined } } as Prisma.InputJsonObject,
        },
      });
      return { action: 'cancelled', activityId: live.id };
    }
    if (n.gone) return remove('not_found');
    if (!n.companyId) return remove('not_filed');

    const dir = await directory(orgId);
    const isInternal = (email: string) => dir.users.has(email) || dir.domains.has(domainOf(email));
    if (!n.participants.some((p) => !isInternal(p))) return remove('internal_only');

    if (tomb && storedMeta(tomb.metadata)?.removedBy !== 'sync') {
      return { action: 'skipped', reason: 'deleted_by_user', activityId: tomb.id };
    }

    const contacts = await db.contact.findMany({
      where: { orgId, deletedAt: null, email: { in: n.participants } },
      select: { id: true, email: true },
      take: MAX_PARTICIPANTS,
    });
    const contactByEmail = new Map(contacts.map((c) => [(c.email ?? '').toLowerCase(), c.id]));
    const attendees = n.participants.map((email) => {
      const contactId = contactByEmail.get(email) ?? null;
      const userId = contactId ? null : (dir.users.get(email) ?? null);
      return {
        orgId,
        contactId,
        userId,
        email: contactId || userId ? null : email,
        responseStatus: n.kind === 'meeting' ? responseOf(n.responses.get(email)) : 'needs_action',
      };
    });

    const meta: CommsCaptureMeta = {
      version: 1,
      kind: n.kind,
      provider: n.provider,
      source: commsSourceFor(n.provider, channel),
      channel,
      sourceType: n.sourceType,
      sourceId: n.sourceId,
      ownerUserId: n.ownerUserId,
      companyId: n.companyId,
      opportunityId: n.opportunityId,
      contactId: n.contactId,
      filedManually: n.filedManually,
      needsOpportunity: n.opportunityId ? false : await needsOpportunity(orgId, n.companyId),
      direction: n.direction,
      participantCount: n.participants.length,
      isPrivate: false,
      ownerDeclined: false,
    };
    const data = {
      type: n.kind,
      subject: n.subject.slice(0, 300),
      description: null,
      startTime: n.kind === 'meeting' ? n.occurredAt : null,
      endTime: n.kind === 'meeting' ? n.endAt : null,
      // Not "planned": the summary counts planned rows past their start as overdue follow-ups.
      status: 'completed' as const,
      entityType: n.opportunityId ? 'opportunity' : 'company',
      entityId: n.opportunityId ?? n.companyId,
      ownerId: n.ownerUserId,
      actorId: null,
      actorType: 'system' as const,
      occurredAt: n.occurredAt,
      metadata: { commsCapture: meta } as unknown as Prisma.InputJsonObject,
    };

    const writeAttendees = async (tx: CommsBridgeDb, activityId: string) => {
      await tx.activityAttendee.deleteMany({ where: { orgId, activityId } });
      await tx.activityAttendee.createMany({ data: attendees.map((a) => ({ ...a, activityId })) });
    };

    if (live) {
      await db.$transaction(async (tx) => {
        await tx.activity.updateMany({ where: { id: live.id, orgId }, data });
        await writeAttendees(tx as unknown as CommsBridgeDb, live.id);
      });
      return { action: 'updated', activityId: live.id };
    }

    let activityId: string;
    try {
      activityId = await db.$transaction(async (tx) => {
        let id: string;
        if (tomb) {
          await tx.activity.updateMany({
            where: { id: tomb.id, orgId, deletedAt: { not: null } },
            data: { ...data, deletedAt: null },
          });
          id = tomb.id;
        } else {
          const created = await tx.activity.create({
            data: { ...data, orgId, idempotencyKey: key },
            select: { id: true },
          });
          id = created.id;
        }
        await writeAttendees(tx as unknown as CommsBridgeDb, id);
        return id;
      });
    } catch (err) {
      // A concurrent pull of the same item created it first; the next pass updates it.
      if ((err as { code?: string }).code === 'P2002') {
        return { action: 'skipped', reason: 'concurrent', activityId: null };
      }
      throw err;
    }
    const involved = [
      ...new Set([n.ownerUserId, ...attendees.flatMap((a) => (a.userId ? [a.userId] : []))]),
    ];
    await onAccountActivityCreated(
      orgId,
      n.companyId,
      activityId,
      n.filedManually ? actorUserId : null,
      involved,
    );
    return { action: 'created', activityId };
  }

  /** Bring the activity for one calendar event in line with the event. */
  async function syncCalendarEvent(
    orgId: string,
    calendarEventId: string,
    opts: { hints?: MeetingHints; actorUserId?: string | null } = {},
  ): Promise<CommsBridgeResult> {
    const select = {
      id: true,
      ownerId: true,
      provider: true,
      externalId: true,
      subject: true,
      startAt: true,
      endAt: true,
      isCancelled: true,
      syncState: true,
      attendees: true,
      organizerEmail: true,
      companyId: true,
      opportunityId: true,
      contactId: true,
      filedManually: true,
      iCalUid: true,
      isPrivate: true,
      ownerResponse: true,
      meetingChannel: true,
      createdAt: true,
    } as const;
    const liveRow = await db.calendarEvent.findFirst({ where: { id: calendarEventId, orgId }, select });
    const row =
      liveRow ??
      (await db.calendarEvent.findFirst({
        where: { id: calendarEventId, orgId, deletedAt: { not: null } },
        select,
      }));
    if (!row) return { action: 'skipped', reason: 'not_found', activityId: null };
    if (!row.externalId) return { action: 'skipped', reason: 'no_external_id', activityId: null };
    if (row.provider !== 'microsoft_graph' && row.provider !== 'google_workspace') {
      return { action: 'skipped', reason: 'not_found', activityId: null };
    }
    type EventRow = NonNullable<typeof row>;

    // Stored columns only speak when set, so rows synced before they existed
    // fall back to the flags kept on the activity.
    const hintsOf = (copy: EventRow): MeetingHints =>
      copy.id === row.id && opts.hints
        ? opts.hints
        : {
            channel: (copy.meetingChannel as MeetingChannel | null) ?? undefined,
            isPrivate: copy.isPrivate || undefined,
            ownerDeclined: copy.ownerResponse === 'declined' || undefined,
          };
    const base = (copy: EventRow, gone: boolean): Normalized => {
      const attendees = emailsOf(copy.attendees);
      return {
        orgId,
        kind: 'meeting',
        provider: copy.provider as 'microsoft_graph' | 'google_workspace',
        externalId: copy.externalId ?? '',
        sourceType: 'calendar_event',
        sourceId: copy.id,
        ownerUserId: copy.ownerId,
        subject: copy.subject,
        occurredAt: copy.startAt,
        endAt: copy.endAt,
        participants: cleanParticipants([...attendees.map((a) => a.email), copy.organizerEmail]),
        responses: new Map(attendees.map((a) => [a.email.trim().toLowerCase(), a.responseStatus ?? ''])),
        cancelled: copy.isCancelled,
        gone,
        companyId: copy.companyId,
        opportunityId: copy.opportunityId,
        contactId: copy.contactId,
        filedManually: copy.filedManually,
        direction: null,
        hints: hintsOf(copy),
      };
    };

    const rowGone = !liveRow || row.syncState === 'DELETED_REMOTE';
    if (!row.iCalUid) return sync(base(row, rowGone), opts.actorUserId ?? null);

    const siblings = await db.calendarEvent.findMany({
      where: { orgId, iCalUid: row.iCalUid },
      select,
      take: 50,
    });
    const copies = siblings.some((c) => c.id === row.id) ? siblings : [...siblings, row];
    const goneOf = (c: EventRow) =>
      c.id === row.id ? rowGone : !c.externalId || c.syncState === 'DELETED_REMOTE';
    const present = copies.filter((c) => !goneOf(c));
    const attending = present
      .filter((c) => !c.isCancelled && !hintsOf(c).ownerDeclined)
      .sort(
        (a, b) =>
          Number(b.filedManually) - Number(a.filedManually) ||
          Number(Boolean(b.companyId)) - Number(Boolean(a.companyId)) ||
          (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0) ||
          a.id.localeCompare(b.id),
      );
    const primary = attending[0] ?? row;
    const n = base(primary, present.length === 0);
    n.cancelled = present.length > 0 && attending.length === 0 && present.some((c) => c.isCancelled);
    const anyPrivate = present.some((c) => hintsOf(c).isPrivate) || (rowGone && hintsOf(row).isPrivate);
    n.hints = {
      channel: hintsOf(primary).channel,
      isPrivate: anyPrivate ? true : copies.some((c) => hintsOf(c).isPrivate === false) ? false : undefined,
      ownerDeclined: present.length > 0 && attending.length === 0 && !n.cancelled,
    };
    n.identity = row.iCalUid;
    n.legacyKeys = copies.flatMap((c) =>
      c.externalId ? [commsActivityKey(orgId, c.provider, 'meeting', c.externalId)] : [],
    );

    // Every colleague attending their copy is an internal attendee of the one activity.
    const dir = await directory(orgId);
    const merged = attending.length ? attending : [primary];
    const raw: Array<string | null> = [];
    for (const copy of merged) {
      const each = base(copy, false);
      raw.push(...each.participants);
      for (const [email, status] of each.responses) {
        if (status && !n.responses.get(email)) n.responses.set(email, status);
      }
    }
    for (const copy of attending) {
      const email = dir.emailOf.get(copy.ownerId);
      if (!email) continue;
      raw.push(email);
      const status = responseOf(n.responses.get(email));
      if (status === 'needs_action') n.responses.set(email, 'accepted');
    }
    n.participants = cleanParticipants(raw);
    return sync(n, opts.actorUserId ?? null);
  }

  /** Bring the activity for one captured email in line with the message. */
  async function syncEmailMessage(
    orgId: string,
    emailMessageId: string,
    opts: { actorUserId?: string | null } = {},
  ): Promise<CommsBridgeResult> {
    const select = {
      id: true,
      userId: true,
      provider: true,
      externalMessageId: true,
      subject: true,
      fromEmail: true,
      toEmails: true,
      ccEmails: true,
      sentAt: true,
      receivedAt: true,
      createdAt: true,
      isOutbound: true,
      companyId: true,
      opportunityId: true,
      contactId: true,
    } as const;
    const liveRow = await db.emailMessage.findFirst({ where: { id: emailMessageId, orgId }, select });
    const row =
      liveRow ??
      (await db.emailMessage.findFirst({
        where: { id: emailMessageId, orgId, deletedAt: { not: null } },
        select,
      }));
    if (!row) return { action: 'skipped', reason: 'not_found', activityId: null };
    return sync(
      {
        orgId,
        kind: 'email',
        provider: row.provider,
        externalId: row.externalMessageId,
        sourceType: 'email_message',
        sourceId: row.id,
        ownerUserId: row.userId,
        subject: row.subject || '(No subject)',
        occurredAt: row.sentAt ?? row.receivedAt ?? row.createdAt,
        endAt: null,
        participants: cleanParticipants([
          row.fromEmail,
          ...emailsOf(row.toEmails).map((a) => a.email),
          ...emailsOf(row.ccEmails).map((a) => a.email),
        ]),
        responses: new Map(),
        cancelled: false,
        gone: !liveRow,
        companyId: row.companyId,
        opportunityId: row.opportunityId,
        contactId: row.contactId,
        filedManually: false,
        direction: row.isOutbound ? 'outbound' : 'inbound',
        hints: {},
      },
      opts.actorUserId ?? null,
    );
  }

  return { syncCalendarEvent, syncEmailMessage };
}

let shared: ReturnType<typeof createCommsActivityBridge> | null = null;

function bridge() {
  shared ??= createCommsActivityBridge();
  return shared;
}

export function syncCalendarEventActivity(
  orgId: string,
  calendarEventId: string,
  opts?: { hints?: MeetingHints; actorUserId?: string | null },
): Promise<CommsBridgeResult> {
  return bridge().syncCalendarEvent(orgId, calendarEventId, opts);
}

export function syncEmailMessageActivity(
  orgId: string,
  emailMessageId: string,
  opts?: { actorUserId?: string | null },
): Promise<CommsBridgeResult> {
  return bridge().syncEmailMessage(orgId, emailMessageId, opts);
}

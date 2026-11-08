/**
 * Capture filing: decide which contact, account and opportunity an email or
 * meeting belongs to, from its participants.
 *
 * 1. Drop the mailbox owner and colleagues on the owner's domain.
 * 2. A participant that is a known contact wins; its account comes with it.
 * 3. Otherwise the first participant domain that matches an account's
 *    domain (free mail domains never match).
 * 4. The opportunity is filled only when the account has exactly one open
 *    bid, so a thread is never filed on the wrong deal. With several, the
 *    item stays on the account and its activity is marked as needing one
 *    (packages/db services/comms-activity.ts).
 *
 * Three bounded queries per item at most; no per-participant lookups.
 */
import type pino from 'pino';

import { prisma, type MeetingHints } from '@bidstack/db';
import { FREE_MAIL_DOMAINS } from '@bidstack/shared';

const FREE_MAIL = FREE_MAIL_DOMAINS;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PARTICIPANTS = 50;

/** Where a captured item is filed. */
export interface CaptureTarget {
  entityType: 'contact' | 'company';
  entityId: string;
  contactId: string | null;
  companyId: string | null;
  opportunityId: string | null;
}

/** The prisma surface this module reads; injectable for tests. */
export interface CaptureDb {
  contact: {
    findMany(args: {
      where: { orgId: string; deletedAt: null; email: { in: string[] } };
      select: { id: true; email: true; companyId: true };
      take: number;
    }): Promise<Array<{ id: string; email: string | null; companyId: string | null }>>;
  };
  company: {
    findFirst(args: {
      where: { orgId: string; deletedAt: null; OR: Array<{ domain: { in: string[]; mode: 'insensitive' } }> };
      select: { id: true; domain: true };
    }): Promise<{ id: string; domain: string | null } | null>;
  };
  opportunity: {
    findMany(args: {
      where: {
        orgId: string;
        companyId: string;
        deletedAt: null;
        stage: { notIn: Array<'closed_won' | 'closed_lost'> };
      };
      select: { id: true };
      orderBy: { updatedAt: 'desc' };
      take: number;
    }): Promise<Array<{ id: string }>>;
  };
}

function domainOf(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1).toLowerCase();
}

/** Lower-cased external participants: no owner, no same-domain colleagues. */
export function externalParticipants(ownerEmail: string | null, participants: readonly string[]): string[] {
  const owner = ownerEmail?.trim().toLowerCase() ?? '';
  const ownerDomain = owner.includes('@') ? domainOf(owner) : '';
  const out: string[] = [];
  for (const raw of participants) {
    const email = raw.trim().toLowerCase();
    if (!EMAIL.test(email) || email === owner) continue;
    if (ownerDomain && domainOf(email) === ownerDomain) continue;
    if (!out.includes(email)) out.push(email);
    if (out.length >= MAX_PARTICIPANTS) break;
  }
  return out;
}

/** Candidate account domains for a participant domain (mail.acme.com -> acme.com). */
function candidateDomains(emails: string[]): string[] {
  const out = new Set<string>();
  for (const email of emails) {
    const d = domainOf(email);
    if (FREE_MAIL.has(d)) continue;
    out.add(d);
    const labels = d.split('.');
    if (labels.length > 2) out.add(labels.slice(-2).join('.'));
  }
  return [...out];
}

async function singleOpenOpportunity(db: CaptureDb, orgId: string, companyId: string): Promise<string | null> {
  const open = await db.opportunity.findMany({
    where: { orgId, companyId, deletedAt: null, stage: { notIn: ['closed_won', 'closed_lost'] } },
    select: { id: true },
    orderBy: { updatedAt: 'desc' },
    take: 2,
  });
  return open.length === 1 ? (open[0]?.id ?? null) : null;
}

/** Resolve the filing target for one captured email or meeting. */
export async function resolveCaptureTarget(
  input: { orgId: string; ownerEmail: string | null; participants: readonly string[] },
  db: CaptureDb = prisma as unknown as CaptureDb,
): Promise<CaptureTarget | null> {
  const externals = externalParticipants(input.ownerEmail, input.participants);
  if (externals.length === 0) return null;

  const contacts = await db.contact.findMany({
    where: { orgId: input.orgId, deletedAt: null, email: { in: externals } },
    select: { id: true, email: true, companyId: true },
    take: MAX_PARTICIPANTS,
  });
  const rank = (email: string | null) => externals.indexOf((email ?? '').toLowerCase());
  const contact = [...contacts].sort((a, b) => rank(a.email) - rank(b.email))[0];

  if (contact) {
    const companyId = contact.companyId ?? null;
    return {
      entityType: 'contact',
      entityId: contact.id,
      contactId: contact.id,
      companyId,
      opportunityId: companyId ? await singleOpenOpportunity(db, input.orgId, companyId) : null,
    };
  }

  const domains = candidateDomains(externals);
  if (domains.length === 0) return null;
  const company = await db.company.findFirst({
    where: { orgId: input.orgId, deletedAt: null, OR: [{ domain: { in: domains, mode: 'insensitive' } }] },
    select: { id: true, domain: true },
  });
  if (!company) return null;
  return {
    entityType: 'company',
    entityId: company.id,
    contactId: null,
    companyId: company.id,
    opportunityId: await singleOpenOpportunity(db, input.orgId, company.id),
  };
}

/** Prisma data fields for a capture target (all null when unfiled). */
export function captureColumns(target: CaptureTarget | null) {
  return {
    contactId: target?.contactId ?? null,
    companyId: target?.companyId ?? null,
    opportunityId: target?.opportunityId ?? null,
  };
}

/** Every column a calendar pull files an event with. */
export function calendarFiling(target: CaptureTarget | null) {
  return {
    relatedEntityType: target?.entityType ?? null,
    relatedEntityId: target?.entityId ?? null,
    ...captureColumns(target),
  };
}

/**
 * Refile an existing calendar event from its participants, unless a user
 * filed it by hand (calendar PATCH/POST). The guard is in the same statement
 * so a concurrent manual filing is never overwritten.
 */
export async function refileUnlessManual(
  key: { orgId: string; ownerId: string; provider: 'google_workspace' | 'microsoft_graph'; externalId: string },
  filing: ReturnType<typeof calendarFiling>,
): Promise<void> {
  // Resolve at call time. A static import is bound by whichever suite loaded
  // this module first, and a later test mock would not see the write.
  const { prisma: db } = await import('@bidstack/db');
  await db.calendarEvent.updateMany({
    where: { ...key, filedManually: false },
    data: filing,
  });
}

const TEAMS_LINK = /^https:\/\/teams\.(microsoft|live)\.com\//i;
const MEET_LINK = /^https:\/\/meet\.google\.com\//i;

/** The Graph event fields the timeline needs and CalendarEvent has no column for. */
export interface GraphMeetingFields {
  isOnlineMeeting?: boolean;
  onlineMeetingProvider?: string;
  onlineMeeting?: { joinUrl?: string } | null;
  onlineMeetingUrl?: string | null;
  sensitivity?: string;
  responseStatus?: { response?: string };
}

export function graphMeetingHints(item: GraphMeetingFields): MeetingHints {
  const joinUrl = item.onlineMeeting?.joinUrl ?? item.onlineMeetingUrl ?? '';
  const teams =
    item.onlineMeetingProvider === 'teamsForBusiness' ||
    item.onlineMeetingProvider === 'teamsForConsumer' ||
    TEAMS_LINK.test(joinUrl);
  const sensitivity = (item.sensitivity ?? '').toLowerCase();
  return {
    channel: teams ? 'teams' : MEET_LINK.test(joinUrl) ? 'google_meet' : 'in_person_or_other',
    isPrivate: sensitivity === 'private' || sensitivity === 'confidential',
    ownerDeclined: (item.responseStatus?.response ?? '').toLowerCase() === 'declined',
  };
}

export interface GoogleMeetingFields {
  visibility?: string;
  hangoutLink?: string;
  conferenceData?: {
    conferenceSolution?: { key?: { type?: string } };
    entryPoints?: Array<{ uri?: string }>;
  };
  attendees?: Array<{ self?: boolean; responseStatus?: string }>;
}

export function googleMeetingHints(item: GoogleMeetingFields): MeetingHints {
  const uris = (item.conferenceData?.entryPoints ?? []).map((e) => e.uri ?? '');
  const type = item.conferenceData?.conferenceSolution?.key?.type ?? '';
  const visibility = (item.visibility ?? '').toLowerCase();
  const self = (item.attendees ?? []).find((a) => a.self);
  return {
    channel: uris.some((u) => TEAMS_LINK.test(u))
      ? 'teams'
      : type === 'hangoutsMeet' || Boolean(item.hangoutLink) || uris.some((u) => MEET_LINK.test(u))
        ? 'google_meet'
        : 'in_person_or_other',
    isPrivate: visibility === 'private' || visibility === 'confidential',
    ownerDeclined: (self?.responseStatus ?? '').toLowerCase() === 'declined',
  };
}

/** CalendarEvent columns the activity bridge reads across every attendee's copy. */
export function meetingColumns(hints: MeetingHints, iCalUid: string | null | undefined) {
  return {
    iCalUid: iCalUid?.trim() || null,
    isPrivate: hints.isPrivate ?? false,
    ownerResponse: hints.ownerDeclined ? 'declined' : null,
    meetingChannel: hints.channel ?? null,
  };
}

/**
 * How many times one provider item may fail the activity bridge before it
 * stops pinning the cursor. The count is per provider id, not per page URL:
 * a new nextLink or sync token must not restart the budget and pin forever.
 * The capture row is already saved. The id is kept on
 * `activityBridgeQuarantine` (id, attempts, time — no subject or body).
 * There is no replay worker and no product UI. After the cursor moves, a
 * quarantined id is not fetched again. The list is the audit, capped so the
 * token cannot grow without bound.
 */
export const ACTIVITY_BRIDGE_RETRY_LIMIT = 3;
const BRIDGE_QUARANTINE_CAP = 50;
// The list remembers ids that already used their budget. Past 50, the oldest
// record is dropped and that id can start a new budget. That is the bound,
// not a silent delete of a message still inside its three attempts.
const MAX_RETRY_IDS = 32;

export type ActivityBridgeQuarantine = { id: string; attempts: number; at: string };
export type ActivityBridgeDelta = { page: string; failedIds: string[] };

const RETRY_KEYS = [
  'activityBridgeRetry',
  'activityBridgeRetryByPage',
  'activityBridgeRetryById',
  'activityBridgeQuarantine',
] as const;

function readCountMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const next: Record<string, number> = {};
  for (const [id, n] of Object.entries(value as Record<string, unknown>)) {
    if (typeof n === 'number' && n > 0) next[id] = n;
  }
  return next;
}

/** Per-id counts. Older per-page maps are folded in by taking the max, then dropped on write. */
function readRetryIds(state: Record<string, unknown>): Record<string, number> {
  const ids = readCountMap(state.activityBridgeRetryById);
  const bump = (id: string, n: number) => {
    ids[id] = Math.max(ids[id] ?? 0, n);
  };
  const pages = state.activityBridgeRetryByPage;
  if (pages && typeof pages === 'object' && !Array.isArray(pages)) {
    for (const counts of Object.values(pages as Record<string, unknown>)) {
      for (const [id, n] of Object.entries(readCountMap(counts))) bump(id, n);
    }
  }
  const legacy = state.activityBridgeRetry as { counts?: Record<string, number> } | undefined;
  for (const [id, n] of Object.entries(readCountMap(legacy?.counts))) bump(id, n);
  return ids;
}

function writeRetryIds(state: Record<string, unknown>, ids: Record<string, number>): void {
  delete state.activityBridgeRetry;
  delete state.activityBridgeRetryByPage;
  if (Object.keys(ids).length === 0) delete state.activityBridgeRetryById;
  else state.activityBridgeRetryById = ids;
}

function quarantineIds(
  state: Record<string, unknown>,
  entries: ActivityBridgeQuarantine[],
): void {
  if (entries.length === 0) return;
  const prior = Array.isArray(state.activityBridgeQuarantine)
    ? (state.activityBridgeQuarantine as ActivityBridgeQuarantine[])
    : [];
  const ids = new Set(entries.map((entry) => entry.id));
  state.activityBridgeQuarantine = [...entries, ...prior.filter((entry) => !ids.has(entry.id))].slice(
    0,
    BRIDGE_QUARANTINE_CAP,
  );
}

/**
 * Record bridge failures. Counts are per provider id, shared across page
 * URLs, so Inbox and Sent cannot reset each other and a new page URL cannot
 * restart a poison id at 1. Counts saturate at the limit. An id at the limit
 * leaves the active map and does not hold the cursor. The map stays at or
 * under the cap. A new id that does not fit is not quarantined early; the
 * page is held until a finished id frees a slot. An empty failure list does
 * not clear other ids.
 * `page` is the caller's cursor key and is not part of the count.
 */
export function noteActivityBridgeFailures(
  state: Record<string, unknown>,
  page: string,
  failedIds: string[],
  now = new Date().toISOString(),
): { hold: boolean; quarantined: string[] } {
  void page;
  const failed = [...new Set(failedIds.filter((id) => id.length > 0))];
  const counts = readRetryIds(state);
  if (failed.length === 0) return { hold: false, quarantined: [] };
  const already = new Set(
    (Array.isArray(state.activityBridgeQuarantine) ? (state.activityBridgeQuarantine as ActivityBridgeQuarantine[]) : [])
      .map((entry) => entry.id),
  );
  const quarantined: string[] = [];
  const deferred: string[] = [];
  const ordered = [
    ...failed.filter((id) => already.has(id) || counts[id] !== undefined),
    ...failed.filter((id) => !already.has(id) && counts[id] === undefined),
  ];
  for (const id of ordered) {
    const prior = already.has(id) ? ACTIVITY_BRIDGE_RETRY_LIMIT : (counts[id] ?? 0);
    const attempts = Math.min(prior + 1, ACTIVITY_BRIDGE_RETRY_LIMIT);
    if (attempts >= ACTIVITY_BRIDGE_RETRY_LIMIT) {
      // Finished ids leave the active map so the cap is only unresolved work.
      quarantined.push(id);
      delete counts[id];
      continue;
    }
    if (counts[id] === undefined && Object.keys(counts).length >= MAX_RETRY_IDS) {
      // No room. Hold the page and try this id next time. Do not quarantine it early.
      deferred.push(id);
      continue;
    }
    delete counts[id];
    counts[id] = attempts;
  }
  writeRetryIds(state, counts);
  quarantineIds(
    state,
    quarantined.map((id) => ({ id, attempts: ACTIVITY_BRIDGE_RETRY_LIMIT, at: now })),
  );
  const hold =
    deferred.length > 0 ||
    failed.some((id) => {
      const attempts = counts[id];
      return typeof attempts === 'number' && attempts < ACTIVITY_BRIDGE_RETRY_LIMIT;
    });
  return { hold, quarantined };
}

function sameCursorValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Cursor fields this run actually changed are copied onto the locked row.
 * Fields it did not change stay as stored, including a value another pull
 * committed after this run read its snapshot. Retry keys are never taken
 * from either snapshot; `deltas` are applied once onto the stored counts.
 */
export function mergeBridgeDeltaState(
  stored: Record<string, unknown>,
  baseline: Record<string, unknown>,
  desired: Record<string, unknown>,
  deltas: ActivityBridgeDelta[],
  now = new Date().toISOString(),
): Record<string, unknown> {
  const result: Record<string, unknown> = structuredClone(stored);
  const retryKeySet = new Set<string>(RETRY_KEYS);
  const keys = new Set([...Object.keys(baseline), ...Object.keys(desired)]);
  for (const key of keys) {
    if (retryKeySet.has(key)) continue;
    const inBaseline = Object.prototype.hasOwnProperty.call(baseline, key);
    const inDesired = Object.prototype.hasOwnProperty.call(desired, key);
    if (inBaseline && inDesired && sameCursorValue(baseline[key], desired[key])) continue;
    // Another pull changed this key after our snapshot. Keep the locked value,
    // including a deletion. A stale run must not put an old page link back
    // or remove a newer delta link.
    const storedHas = Object.prototype.hasOwnProperty.call(result, key);
    const storedValue = storedHas ? result[key] : undefined;
    const baselineValue = inBaseline ? baseline[key] : undefined;
    if (storedHas !== inBaseline || (storedHas && !sameCursorValue(storedValue, baselineValue))) continue;
    if (!inDesired) delete result[key];
    else result[key] = structuredClone(desired[key]);
  }
  for (const key of RETRY_KEYS) {
    if (key in stored) result[key] = structuredClone(stored[key]);
    else delete result[key];
  }
  for (const delta of deltas) noteActivityBridgeFailures(result, delta.page, delta.failedIds, now);
  return result;
}

/**
 * Run the activity bridge for a synced item. A failure never undoes the
 * capture. Callers that advance an incremental cursor must keep the current
 * page when this returns false, until {@link noteActivityBridgeFailures}
 * quarantines a repeated failure.
 */
export async function bridgeActivity(
  run: () => Promise<unknown>,
  log: pino.Logger,
  ctx: Record<string, unknown>,
): Promise<boolean> {
  try {
    await run();
    return true;
  } catch (err) {
    log.warn({ err, ...ctx }, 'Could not update the account activity for a synced item');
    return false;
  }
}

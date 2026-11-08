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
 * There is no replay worker and no product UI.
 *
 * The quarantine list is a bounded audit, not a permanent exclusion. It keeps
 * at most {@link ACTIVITY_BRIDGE_QUARANTINE_CAP} ids. Past that, the oldest
 * record is dropped and that id can start a new budget of
 * {@link ACTIVITY_BRIDGE_RETRY_LIMIT}. Ids still inside that budget stay in
 * the retry map and are not dropped to make room, and they are not removed
 * by age. A later success removes an id from the retry map only.
 */
export const ACTIVITY_BRIDGE_RETRY_LIMIT = 3;
export const ACTIVITY_BRIDGE_QUARANTINE_CAP = 50;
/** Ids being counted for the page in hand. This is not the whole backlog. */
export const ACTIVITY_BRIDGE_ACTIVE_CAP = 32;
/**
 * Unexhausted ids that were not on the page just read. They stay here with
 * their attempt counts. The cap is backpressure: a new id is refused, not
 * swapped in, and the cursor is held. Nothing is dropped by age.
 */
export const ACTIVITY_BRIDGE_PENDING_CAP = 256;
/** How many preserved ids one run retries before the cursor may move. */
export const ACTIVITY_BRIDGE_DRAIN_BATCH = 8;

export type ActivityBridgeQuarantine = { id: string; attempts: number; at: string };
export type ActivityBridgeDelta = {
  page: string;
  failedIds: string[];
  /**
   * Ids this run actually visited that are not outstanding failures: the
   * bridge succeeded, or the provider item is gone or deliberately not retried.
   * Ids this run did not see stay in the map.
   */
  settledIds?: string[];
  /**
   * A drain pass must not park the active page's other ids. Page observations
   * leave this unset and do park them.
   */
  parkUnseen?: boolean;
};

/** Record one page observation and, when a drain ran, its outcome as a second delta. */
export function appendBridgeObservations(
  deltas: ActivityBridgeDelta[],
  page: string,
  failedIds: readonly string[],
  settledIds: readonly string[],
  drained: { failedIds: readonly string[]; settledIds: readonly string[] } | null,
): void {
  deltas.push({ page, failedIds: [...failedIds], settledIds: [...settledIds] });
  if (!drained) return;
  deltas.push({
    page: `${page}#drain`,
    failedIds: [...drained.failedIds],
    settledIds: [...drained.settledIds],
    parkUnseen: false,
  });
}

/** The locked cursor changed a key this run needed to write. The job retries the whole pull. */
export class CursorKeyConflictError extends Error {
  readonly keys: string[];

  constructor(keys: string[]) {
    super(
      `Cursor key conflict on ${keys.join(', ')}. The locked row no longer matches this run, so nothing was written.`,
    );
    this.name = 'CursorKeyConflictError';
    this.keys = keys;
  }
}

const RETRY_KEYS = [
  'activityBridgeRetry',
  'activityBridgeRetryByPage',
  'activityBridgeRetryById',
  'activityBridgePending',
  'activityBridgeQuarantine',
] as const;

export type ActivityBridgePending = { id: string; attempts: number };

function readPending(state: Record<string, unknown>): ActivityBridgePending[] {
  if (!Array.isArray(state.activityBridgePending)) return [];
  const rows: ActivityBridgePending[] = [];
  for (const entry of state.activityBridgePending) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as { id?: unknown; attempts?: unknown };
    if (typeof row.id !== 'string' || row.id.length === 0) continue;
    if (typeof row.attempts !== 'number' || row.attempts <= 0) continue;
    rows.push({ id: row.id, attempts: row.attempts });
  }
  return rows;
}

function writePending(state: Record<string, unknown>, rows: ActivityBridgePending[]): void {
  if (rows.length === 0) delete state.activityBridgePending;
  else state.activityBridgePending = rows;
}

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
    ACTIVITY_BRIDGE_QUARANTINE_CAP,
  );
}

/**
 * Record bridge failures. Counts are per provider id, shared across page
 * URLs, so Inbox and Sent cannot reset each other and a new page URL cannot
 * restart a poison id at 1. Counts saturate at the limit. An id at the limit
 * leaves the active map and does not hold the cursor. The map stays at or
 * under the active cap. Ids this page did not see move to
 * `activityBridgePending` with their attempt counts. That queue is bounded.
 * At the cap a new id is not admitted and is not swapped for an older one;
 * the cursor stays. An empty observation does not clear other ids and does
 * not let the cursor pass them: those ids move to the pending queue. Success
 * removes only the ids in `settledIds`. Unexhausted ids are not dropped by age.
 * This budget is only for a row that was already captured. A fetch, target
 * lookup, or insert that failed before the row existed is not a `failedIds`
 * entry; the caller holds the cursor and does not spend this budget.
 * `page` is the caller's cursor key and is not part of the count.
 * `parkUnseen` is false for a drain pass, which retries specific ids and must
 * not treat the rest of the backlog as absent.
 */
export function noteActivityBridgeFailures(
  state: Record<string, unknown>,
  page: string,
  failedIds: string[],
  now = new Date().toISOString(),
  settledIds: readonly string[] = [],
  parkUnseen = true,
  seenIds?: readonly string[],
): { hold: boolean; quarantined: string[]; pending: number; backpressure: boolean } {
  void page;
  const failed = [...new Set(failedIds.filter((id) => id.length > 0))];
  const failedSet = new Set(failed);
  const settled = [...new Set(settledIds.filter((id) => id.length > 0 && !failedSet.has(id)))];
  if (failed.length === 0 && settled.length === 0) {
    const counts = readRetryIds(state);
    const pending = readPending(state);
    let backpressure = false;
    if (parkUnseen) {
      for (const [id, attempts] of Object.entries(counts)) {
        if (!rememberPending(pending, id, attempts)) {
          backpressure = true;
          continue;
        }
        delete counts[id];
      }
      writeRetryIds(state, counts);
      writePending(state, pending);
    }
    return {
      hold: backpressure || pending.length > 0 || underLimit(counts),
      quarantined: [],
      pending: pending.length,
      backpressure,
    };
  }
  const counts = readRetryIds(state);
  const pending = readPending(state);
  const observed = new Set<string>([...(seenIds ?? []), ...failed, ...settled]);
  let backpressure = false;
  if (parkUnseen) {
    for (const [id, attempts] of Object.entries(counts)) {
      if (observed.has(id)) continue;
      if (!rememberPending(pending, id, attempts)) {
        backpressure = true;
        continue;
      }
      delete counts[id];
    }
  }
  for (const id of settled) {
    delete counts[id];
    removePending(pending, id);
  }
  backpressure ||= pending.length > ACTIVITY_BRIDGE_PENDING_CAP;
  if (failed.length === 0) {
    writeRetryIds(state, counts);
    writePending(state, pending);
    return {
      hold: backpressure || pending.length > 0 || underLimit(counts),
      quarantined: [],
      pending: pending.length,
      backpressure,
    };
  }
  const already = new Set(
    (Array.isArray(state.activityBridgeQuarantine) ? (state.activityBridgeQuarantine as ActivityBridgeQuarantine[]) : [])
      .map((entry) => entry.id),
  );
  const quarantined: string[] = [];
  let refused = false;
  const known = new Set<string>([...Object.keys(counts), ...pending.map((row) => row.id)]);
  const ordered = [
    ...failed.filter((id) => already.has(id) || known.has(id)),
    ...failed.filter((id) => !already.has(id) && !known.has(id)),
  ];
  for (const id of ordered) {
    const prior = already.has(id)
      ? ACTIVITY_BRIDGE_RETRY_LIMIT
      : Math.max(counts[id] ?? 0, pendingAttempt(pending, id));
    const attempts = Math.min(prior + 1, ACTIVITY_BRIDGE_RETRY_LIMIT);
    if (attempts >= ACTIVITY_BRIDGE_RETRY_LIMIT) {
      delete counts[id];
      removePending(pending, id);
      quarantined.push(id);
      continue;
    }
    if (Object.keys(counts).length < ACTIVITY_BRIDGE_ACTIVE_CAP || counts[id] !== undefined) {
      removePending(pending, id);
      counts[id] = attempts;
      continue;
    }
    if (rememberPending(pending, id, attempts)) {
      delete counts[id];
      continue;
    }
    // Both bounds are full. Do not grow the active map past its cap and do
    // not evict someone else. The cursor stays, so this page is read again.
    refused = true;
  }
  backpressure = backpressure || refused;
  writeRetryIds(state, counts);
  writePending(state, pending);
  quarantineIds(
    state,
    quarantined.map((id) => ({ id, attempts: ACTIVITY_BRIDGE_RETRY_LIMIT, at: now })),
  );
  return {
    hold: backpressure || refused || pending.length > 0 || underLimit(counts),
    quarantined,
    pending: Math.min(pending.length, ACTIVITY_BRIDGE_PENDING_CAP),
    backpressure,
  };
}

function underLimit(counts: Record<string, number>): boolean {
  return Object.values(counts).some((attempts) => attempts < ACTIVITY_BRIDGE_RETRY_LIMIT);
}

function pendingAttempt(rows: ActivityBridgePending[], id: string): number {
  return rows.find((row) => row.id === id)?.attempts ?? 0;
}

function removePending(rows: ActivityBridgePending[], id: string): void {
  const index = rows.findIndex((row) => row.id === id);
  if (index >= 0) rows.splice(index, 1);
}

/** @returns false when the id was not stored because the queue is already full. */
function rememberPending(rows: ActivityBridgePending[], id: string, attempts: number): boolean {
  const existing = rows.find((row) => row.id === id);
  if (existing) {
    existing.attempts = Math.max(existing.attempts, attempts);
    return true;
  }
  if (rows.length >= ACTIVITY_BRIDGE_PENDING_CAP) return false;
  rows.push({ id, attempts });
  return true;
}

/** The next ids a run should retry. They stay in the queue until a later observation settles or counts them. */
export function claimActivityBridgeDrain(
  state: Record<string, unknown>,
  limit = ACTIVITY_BRIDGE_DRAIN_BATCH,
): string[] {
  return readPending(state).slice(0, limit).map((row) => row.id);
}

/**
 * Retry a bounded batch of preserved ids. `gone` means the saved capture row
 * is no longer there, so the bridge cannot run; that id is settled. A failure
 * counts one attempt. This pass does not park the active page's other ids.
 */
export async function drainPendingActivityBridges(
  state: Record<string, unknown>,
  run: (providerId: string) => Promise<boolean | 'gone'>,
  now = new Date().toISOString(),
): Promise<{ hold: boolean; quarantined: string[]; pending: number; backpressure: boolean; failedIds: string[]; settledIds: string[] } | null> {
  const ids = claimActivityBridgeDrain(state);
  if (ids.length === 0) return null;
  const failed: string[] = [];
  const settled: string[] = [];
  for (const id of ids) {
    try {
      const result = await run(id);
      if (result === true || result === 'gone') settled.push(id);
      else failed.push(id);
    } catch {
      // One retry throwing must not skip the rest of the batch or the commit.
      failed.push(id);
    }
  }
  const noted = noteActivityBridgeFailures(state, 'drain', failed, now, settled, false);
  return { ...noted, failedIds: failed, settledIds: settled };
}

const CALENDAR_CURSOR_KEYS = ['calendarNextLink', 'calendarDeltaLink'] as const;

function sameCalendarGroup(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return CALENDAR_CURSOR_KEYS.every((key) => samePresence(cursorPresence(left, key), cursorPresence(right, key)));
}

function sameCursorValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

function cursorPresence(record: Record<string, unknown>, key: string): { present: boolean; value: unknown } {
  const present = Object.prototype.hasOwnProperty.call(record, key);
  return { present, value: present ? record[key] : undefined };
}

function samePresence(
  left: { present: boolean; value: unknown },
  right: { present: boolean; value: unknown },
): boolean {
  return left.present === right.present && (!left.present || sameCursorValue(left.value, right.value));
}

/**
 * Cursor fields this run actually changed are copied onto the locked row.
 * Fields it did not change stay as stored, including a value another pull
 * committed after this run read its snapshot. Retry keys are never taken
 * from either snapshot; `deltas` are applied once onto the stored counts.
 *
 * `calendarNextLink` and `calendarDeltaLink` are one cursor: the next read
 * follows the nextLink first. If this run changes either key, both keys must
 * still match the snapshot, or the locked row must already be the desired
 * pair. A moved sibling key aborts the whole merge. A later key is not
 * written beside a conflicting one.
 * When the locked row already matches this run, the write is idempotent and
 * the retry deltas still apply.
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
  const calendarKeySet = new Set<string>(CALENDAR_CURSOR_KEYS);
  const keys = new Set([...Object.keys(baseline), ...Object.keys(desired)]);
  const conflicts: string[] = [];
  const writes: string[] = [];
  // calendarNextLink and calendarDeltaLink are one cursor. A write of either
  // key is refused when the other key has also moved, even if this run did
  // not intend to change that other key.
  if (!sameCalendarGroup(baseline, desired)) {
    if (sameCalendarGroup(result, desired)) {
      // The locked row already has this run's cursor. Nothing to write.
    } else if (sameCalendarGroup(result, baseline)) {
      for (const key of CALENDAR_CURSOR_KEYS) {
        if (!samePresence(cursorPresence(baseline, key), cursorPresence(desired, key))) writes.push(key);
      }
    } else {
      conflicts.push(...CALENDAR_CURSOR_KEYS);
    }
  }
  for (const key of keys) {
    if (retryKeySet.has(key) || calendarKeySet.has(key)) continue;
    const base = cursorPresence(baseline, key);
    const want = cursorPresence(desired, key);
    if (samePresence(base, want)) continue;
    const locked = cursorPresence(result, key);
    if (samePresence(locked, want)) continue;
    if (!samePresence(locked, base)) {
      conflicts.push(key);
      continue;
    }
    writes.push(key);
  }
  if (conflicts.length > 0) throw new CursorKeyConflictError([...new Set(conflicts)].sort());
  for (const key of writes) {
    const want = cursorPresence(desired, key);
    if (!want.present) delete result[key];
    else result[key] = structuredClone(want.value);
  }
  for (const key of RETRY_KEYS) {
    if (key in stored) result[key] = structuredClone(stored[key]);
    else delete result[key];
  }
  for (const delta of deltas) {
    noteActivityBridgeFailures(
      result,
      delta.page,
      delta.failedIds,
      now,
      delta.settledIds ?? [],
      delta.parkUnseen !== false,
    );
  }
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

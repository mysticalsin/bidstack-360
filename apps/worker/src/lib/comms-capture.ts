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

export type ActivityBridgeQuarantine = { id: string; attempts: number; at: string; kind?: ActivityBridgeKind };
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
  /** Mail and calendar share a token row. A drain only retries its own kind. */
  kind?: ActivityBridgeKind;
};

export type ActivityBridgeKind = 'email' | 'calendar';

/** Record one page observation and, when a drain ran, its outcome as a second delta. */
export function appendBridgeObservations(
  deltas: ActivityBridgeDelta[],
  page: string,
  failedIds: readonly string[],
  settledIds: readonly string[],
  drained: { failedIds: readonly string[]; settledIds: readonly string[] } | null,
  kind?: ActivityBridgeKind,
): void {
  deltas.push({ page, failedIds: [...failedIds], settledIds: [...settledIds], kind });
  if (!drained) return;
  deltas.push({
    page: `${page}#drain`,
    failedIds: [...drained.failedIds],
    settledIds: [...drained.settledIds],
    parkUnseen: false,
    kind,
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

const SLOT = '\u001f';

/** Mail and calendar can share a provider id. Counts use this key so one stream cannot erase the other. */
export function activityBridgeSlot(id: string, kind?: ActivityBridgeKind): string {
  return kind ? `${kind}${SLOT}${id}` : id;
}

function splitActivityBridgeSlot(key: string): { id: string; kind?: ActivityBridgeKind } {
  const mark = key.indexOf(SLOT);
  if (mark < 0) return { id: key };
  const kind = key.slice(0, mark);
  if (kind === 'email' || kind === 'calendar') return { id: key.slice(mark + SLOT.length), kind };
  return { id: key };
}

const RETRY_KEYS = [
  'activityBridgeRetry',
  'activityBridgeRetryByPage',
  'activityBridgeRetryById',
  'activityBridgePending',
  'activityBridgeQuarantine',
  'activityBridgeStream',
] as const;

export type ActivityBridgePending = { id: string; attempts: number; kind?: ActivityBridgeKind };

function readPending(state: Record<string, unknown>): ActivityBridgePending[] {
  if (!Array.isArray(state.activityBridgePending)) return [];
  const rows: ActivityBridgePending[] = [];
  for (const entry of state.activityBridgePending) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as { id?: unknown; attempts?: unknown; kind?: unknown };
    if (typeof row.id !== 'string' || row.id.length === 0) continue;
    if (typeof row.attempts !== 'number' || row.attempts <= 0) continue;
    const kind = row.kind === 'email' || row.kind === 'calendar' ? row.kind : undefined;
    rows.push({ id: row.id, attempts: row.attempts, ...(kind ? { kind } : {}) });
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
  const ids = new Set(entries.map((entry) => activityBridgeSlot(entry.id, entry.kind)));
  const merged = [...entries, ...prior.filter((entry) => !ids.has(activityBridgeSlot(entry.id, entry.kind)))];
  const byKind = new Map<string, ActivityBridgeQuarantine[]>();
  for (const entry of merged) {
    const key = entry.kind ?? '';
    const list = byKind.get(key) ?? [];
    list.push(entry);
    byKind.set(key, list);
  }
  const kept: ActivityBridgeQuarantine[] = [];
  for (const list of byKind.values()) kept.push(...list.slice(0, ACTIVITY_BRIDGE_QUARANTINE_CAP));
  state.activityBridgeQuarantine = kept;
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
  kind?: ActivityBridgeKind,
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
      backpressure = parkUnseenCounts(state, counts, pending, new Set(), kind) || backpressure;
      writeRetryIds(state, counts);
      writePending(state, pending);
    }
    pruneBridgeStream(state, counts, pending);
    return {
      hold: bridgeCursorHeld(pending, counts, backpressure, kind),
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
    backpressure = parkUnseenCounts(state, counts, pending, observed, kind) || backpressure;
  }
  for (const id of settled) {
    delete counts[activityBridgeSlot(id, kind)];
    removePending(pending, id, kind);
    forgetStream(state, id, kind);
  }
  backpressure ||= pendingOverCap(pending, kind);
  if (failed.length === 0) {
    writeRetryIds(state, counts);
    writePending(state, pending);
    pruneBridgeStream(state, counts, pending);
    return {
      hold: bridgeCursorHeld(pending, counts, backpressure, kind),
      quarantined: [],
      pending: pending.length,
      backpressure,
    };
  }
  const already = new Set(
    (Array.isArray(state.activityBridgeQuarantine) ? (state.activityBridgeQuarantine as ActivityBridgeQuarantine[]) : [])
      .filter((entry) => (kind ? entry.kind === kind || !entry.kind : !entry.kind))
      .map((entry) => entry.id),
  );
  const quarantined: Array<{ id: string; attempts: number }> = [];
  let refused = false;
  const known = new Set<string>([...Object.keys(counts), ...pending.map((row) => row.id)]);
  const ordered = [
    ...failed.filter((id) => already.has(id) || known.has(id)),
    ...failed.filter((id) => !already.has(id) && !known.has(id)),
  ];
  for (const id of ordered) {
    const slot = activityBridgeSlot(id, kind);
    const untypedFloor = Math.max(counts[id] ?? 0, pendingAttempt(pending, id));
    const typedFloor = Math.max(counts[slot] ?? 0, pendingAttempt(pending, id, kind));
    const quarantinedFloor = quarantineAttempt(state, id, kind);
    const prior = already.has(id)
      ? Math.max(ACTIVITY_BRIDGE_RETRY_LIMIT, untypedFloor, typedFloor, quarantinedFloor)
      : Math.max(typedFloor, untypedFloor, quarantinedFloor);
    // A surviving untyped attempt is a floor. Saturating at the limit must not
    // restart that id at 1, and it must not store a lower number than the floor.
    const attempts = Math.max(prior, Math.min(prior + 1, ACTIVITY_BRIDGE_RETRY_LIMIT));
    const tagged = kind ?? readStream(state)[slot];
    if (attempts >= ACTIVITY_BRIDGE_RETRY_LIMIT) {
      delete counts[slot];
      removePending(pending, id, kind);
      forgetStream(state, id, kind);
      quarantined.push({ id, attempts });
      continue;
    }
    const activeCount = Object.keys(counts).filter((key) => {
      if (!kind) return true;
      return splitActivityBridgeSlot(key).kind === kind;
    }).length;
    if (activeCount < ACTIVITY_BRIDGE_ACTIVE_CAP || counts[slot] !== undefined) {
      removePending(pending, id, kind);
      counts[slot] = attempts;
      if (tagged) rememberStream(state, id, tagged);
      continue;
    }
    if (rememberPending(pending, id, attempts, tagged)) {
      delete counts[slot];
      if (tagged) rememberStream(state, id, tagged);
      continue;
    }
    // Both bounds are full. Do not grow the active map past its cap and do
    // not evict someone else. The cursor stays, so this page is read again.
    // The stream map is not written: a refused id must not leave metadata behind.
    refused = true;
  }
  backpressure = backpressure || refused;
  writeRetryIds(state, counts);
  writePending(state, pending);
  quarantineIds(
    state,
    quarantined.map((row) => ({ id: row.id, attempts: row.attempts, at: now, ...(kind ? { kind } : {}) })),
  );
  pruneBridgeStream(state, counts, pending);
  return {
    hold: bridgeCursorHeld(pending, counts, backpressure || refused, kind),
    quarantined: quarantined.map((row) => row.id),
    pending: Math.min(pendingForKind(pending, kind).length, ACTIVITY_BRIDGE_PENDING_CAP),
    backpressure,
  };
}

function underLimit(counts: Record<string, number>): boolean {
  return Object.values(counts).some((attempts) => attempts < ACTIVITY_BRIDGE_RETRY_LIMIT);
}

function sameBridgeIdentity(row: ActivityBridgePending, id: string, kind?: ActivityBridgeKind): boolean {
  return row.id === id && (kind ? row.kind === kind : !row.kind);
}

function pendingAttempt(rows: ActivityBridgePending[], id: string, kind?: ActivityBridgeKind): number {
  return rows.find((row) => sameBridgeIdentity(row, id, kind))?.attempts ?? 0;
}

/** Same id and same stream, plus an untyped row for that id. Another stream's count is not a floor. */
function quarantineAttempt(state: Record<string, unknown>, id: string, kind?: ActivityBridgeKind): number {
  const rows = Array.isArray(state.activityBridgeQuarantine)
    ? (state.activityBridgeQuarantine as ActivityBridgeQuarantine[])
    : [];
  let floor = 0;
  for (const entry of rows) {
    if (entry.id !== id || typeof entry.attempts !== 'number') continue;
    if (kind) {
      if (entry.kind === kind || !entry.kind) floor = Math.max(floor, entry.attempts);
    } else if (!entry.kind) {
      floor = Math.max(floor, entry.attempts);
    }
  }
  return floor;
}

function removePending(rows: ActivityBridgePending[], id: string, kind?: ActivityBridgeKind): void {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (sameBridgeIdentity(rows[index]!, id, kind)) rows.splice(index, 1);
  }
}

function pendingForKind(rows: ActivityBridgePending[], kind?: ActivityBridgeKind): ActivityBridgePending[] {
  if (!kind) return rows.filter((row) => !row.kind);
  return rows.filter((row) => row.kind === kind);
}

/** Another stream's queue does not fill this stream's cap. */
function pendingOverCap(rows: ActivityBridgePending[], kind?: ActivityBridgeKind): boolean {
  return pendingForKind(rows, kind).length > ACTIVITY_BRIDGE_PENDING_CAP;
}

function bridgeCursorHeld(
  pending: ActivityBridgePending[],
  counts: Record<string, number>,
  backpressure: boolean,
  kind?: ActivityBridgeKind,
): boolean {
  if (!kind) return backpressure || pending.length > 0 || underLimit(counts);
  const minePending = pending.some((row) => row.kind === kind || !row.kind);
  const mineCounts = Object.fromEntries(
    Object.entries(counts).filter(([key]) => {
      const parsed = splitActivityBridgeSlot(key);
      return parsed.kind === kind || !parsed.kind;
    }),
  );
  return backpressure || minePending || underLimit(mineCounts);
}

/** Move unseen counts into the pending queue. Another stream's slot is left untouched. */
function parkUnseenCounts(
  state: Record<string, unknown>,
  counts: Record<string, number>,
  pending: ActivityBridgePending[],
  observed: Set<string>,
  kind?: ActivityBridgeKind,
): boolean {
  let backpressure = false;
  for (const [key, attempts] of Object.entries(counts)) {
    const parsed = splitActivityBridgeSlot(key);
    if (kind && parsed.kind !== kind) continue;
    if (observed.has(parsed.id)) continue;
    const tagged = parsed.kind ?? readStream(state)[activityBridgeSlot(parsed.id, parsed.kind)];
    if (!rememberPending(pending, parsed.id, attempts, tagged)) {
      backpressure = true;
      continue;
    }
    delete counts[key];
    if (tagged) rememberStream(state, parsed.id, tagged);
  }
  return backpressure;
}

function pruneBridgeStream(
  state: Record<string, unknown>,
  counts: Record<string, number>,
  pending: ActivityBridgePending[],
): void {
  const live = new Set<string>([
    ...Object.keys(counts),
    ...pending.map((row) => activityBridgeSlot(row.id, row.kind)),
  ]);
  const next = readStream(state);
  let changed = false;
  for (const key of Object.keys(next)) {
    if (live.has(key)) continue;
    delete next[key];
    changed = true;
  }
  if (!changed) return;
  if (Object.keys(next).length === 0) delete state.activityBridgeStream;
  else state.activityBridgeStream = next;
}

/** @returns false when the id was not stored because the queue is already full. */
function rememberPending(
  rows: ActivityBridgePending[],
  id: string,
  attempts: number,
  kind?: ActivityBridgeKind,
): boolean {
  const existing = rows.find((row) => sameBridgeIdentity(row, id, kind));
  if (existing) {
    existing.attempts = Math.max(existing.attempts, attempts);
    if (kind) existing.kind = kind;
    return true;
  }
  const used = rows.filter((row) => (kind ? row.kind === kind : !row.kind)).length;
  if (used >= ACTIVITY_BRIDGE_PENDING_CAP) return false;
  rows.push({ id, attempts, ...(kind ? { kind } : {}) });
  return true;
}

function readStream(state: Record<string, unknown>): Record<string, ActivityBridgeKind> {
  const raw = state.activityBridgeStream;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const next: Record<string, ActivityBridgeKind> = {};
  for (const [id, kind] of Object.entries(raw as Record<string, unknown>)) {
    if (kind === 'email' || kind === 'calendar') next[id] = kind;
  }
  return next;
}

function rememberStream(state: Record<string, unknown>, id: string, kind: ActivityBridgeKind): void {
  const next = readStream(state);
  next[activityBridgeSlot(id, kind)] = kind;
  state.activityBridgeStream = next;
}

function forgetStream(state: Record<string, unknown>, id: string, kind?: ActivityBridgeKind): void {
  const next = readStream(state);
  const key = activityBridgeSlot(id, kind);
  if (!(key in next)) return;
  delete next[key];
  if (Object.keys(next).length === 0) delete state.activityBridgeStream;
  else state.activityBridgeStream = next;
}

export type LegacyBridgeClass = 'email' | 'calendar' | 'both' | 'absent' | 'unknown';

/** A classification to apply to the locked row. Unknown is recorded and does not delete anything. */
export type LegacyBridgeMigration = { id: string; result: LegacyBridgeClass; attempts: number };

/**
 * Decide which resource an old untyped id belongs to. A lookup that cannot
 * run, or that throws, is `unknown`: the id stays untyped and the cursor
 * stays. Absence is returned only when both stores answered and neither has
 * the row. One store answering present is not enough if the other did not answer.
 */
export async function classifyStoredBridgeId(
  db: {
    calendarEvent?: { findFirst?: (args: unknown) => Promise<{ id?: string } | null> };
    emailMessage?: { findFirst?: (args: unknown) => Promise<{ id?: string } | null> };
  },
  scope: { orgId: string; ownerId: string },
  id: string,
): Promise<LegacyBridgeClass> {
  const look = async (model: 'calendarEvent' | 'emailMessage') => {
    const find = db[model]?.findFirst;
    if (typeof find !== 'function') return 'unknown' as const;
    try {
      const row = await find({
        where:
          model === 'emailMessage'
            ? { orgId: scope.orgId, userId: scope.ownerId, externalMessageId: id, deletedAt: null }
            : { orgId: scope.orgId, ownerId: scope.ownerId, externalId: id, deletedAt: null },
        select: { id: true },
      });
      return row ? ('present' as const) : ('absent' as const);
    } catch {
      return 'unknown' as const;
    }
  };
  const calendar = await look('calendarEvent');
  const email = await look('emailMessage');
  if (calendar === 'unknown' || email === 'unknown') return 'unknown';
  if (calendar === 'present' && email === 'present') return 'both';
  if (calendar === 'present') return 'calendar';
  if (email === 'present') return 'email';
  return 'absent';
}

/**
 * Give an untyped pending id a resource only after both stores have been asked.
 * `both` keeps a row for each resource. `absent` drops the id because neither
 * store has a capture row. `unknown` leaves it, so the cursor is not moved past it.
 */
function pendingRoom(rows: ActivityBridgePending[], kind: ActivityBridgeKind, id: string): boolean {
  if (rows.some((row) => row.id === id && row.kind === kind)) return true;
  return rows.filter((row) => row.kind === kind).length < ACTIVITY_BRIDGE_PENDING_CAP;
}

/**
 * Apply classifications to untyped pending, counts, and quarantine.
 * Unknown leaves the untyped rows. A `both` result is admitted only when
 * every destination fits; otherwise the untyped row stays. Absent removes
 * the untyped row only after both stores have answered empty.
 */
export function applyLegacyMigration(
  state: Record<string, unknown>,
  plans: readonly LegacyBridgeMigration[],
): { refused: boolean; streams: ActivityBridgeKind[] } {
  let refused = false;
  const streams = new Set<ActivityBridgeKind>();
  if (plans.length === 0) return { refused: false, streams: [] };
  const pending = readPending(state);
  const counts = readRetryIds(state);
  const quarantine = Array.isArray(state.activityBridgeQuarantine)
    ? (state.activityBridgeQuarantine as ActivityBridgeQuarantine[])
    : [];
  for (const plan of plans) {
    if (plan.result === 'unknown') continue;
    const legacyPending = pending.find((row) => row.id === plan.id && !row.kind);
    const legacyCount = counts[plan.id];
    const legacyQuarantine = quarantine.find((entry) => entry.id === plan.id && !entry.kind);
    const attempts = Math.max(plan.attempts, legacyCount ?? 0, legacyPending?.attempts ?? 0, 1);
    if (plan.result === 'absent') {
      delete counts[plan.id];
      removePending(pending, plan.id);
      forgetStream(state, plan.id);
      const nextQuarantine = quarantine.filter((entry) => !(entry.id === plan.id && !entry.kind));
      quarantine.splice(0, quarantine.length, ...nextQuarantine);
      continue;
    }
    const kinds: ActivityBridgeKind[] = plan.result === 'both' ? ['email', 'calendar'] : [plan.result];
    const needsPending = Boolean(legacyPending) || legacyCount !== undefined;
    if (needsPending && !kinds.every((kind) => pendingRoom(pending, kind, plan.id))) {
      refused = true;
      for (const kind of kinds) {
        if (!pendingRoom(pending, kind, plan.id)) streams.add(kind);
      }
      continue;
    }
    delete counts[plan.id];
    removePending(pending, plan.id);
    forgetStream(state, plan.id);
    if (needsPending) {
      for (const kind of kinds) {
        rememberPending(pending, plan.id, attempts, kind);
        rememberStream(state, plan.id, kind);
      }
    }
    if (legacyQuarantine) {
      const fits = kinds.every((kind) => {
        if (quarantine.some((entry) => entry.id === plan.id && entry.kind === kind)) return true;
        return quarantine.filter((entry) => entry.kind === kind).length < ACTIVITY_BRIDGE_QUARANTINE_CAP;
      });
      if (!fits) {
        refused = true;
        for (const kind of kinds) {
          const present = quarantine.some((entry) => entry.id === plan.id && entry.kind === kind);
          const room = quarantine.filter((entry) => entry.kind === kind).length < ACTIVITY_BRIDGE_QUARANTINE_CAP;
          if (!present && !room) streams.add(kind);
        }
      } else {
        const rest = quarantine.filter((entry) => !(entry.id === plan.id && !entry.kind));
        quarantine.splice(0, quarantine.length, ...rest);
        for (const kind of kinds) {
          const kept = Math.max(
            legacyQuarantine.attempts,
            quarantine.find((entry) => entry.id === plan.id && entry.kind === kind)?.attempts ?? 0,
          );
          const existing = quarantine.findIndex((entry) => entry.id === plan.id && entry.kind === kind);
          if (existing >= 0) {
            quarantine[existing] = { ...quarantine[existing]!, attempts: kept };
            continue;
          }
          quarantine.unshift({ id: plan.id, attempts: kept, at: legacyQuarantine.at, kind });
        }
      }
    }
  }
  writeRetryIds(state, counts);
  writePending(state, pending);
  if (quarantine.length === 0) delete state.activityBridgeQuarantine;
  else state.activityBridgeQuarantine = quarantine;
  pruneBridgeStream(state, counts, pending);
  return { refused, streams: [...streams] };
}

export async function migrateLegacyBridgePending(
  state: Record<string, unknown>,
  classify: (id: string) => Promise<LegacyBridgeClass>,
): Promise<LegacyBridgeMigration[]> {
  const pending = readPending(state);
  const counts = readRetryIds(state);
  const quarantine = Array.isArray(state.activityBridgeQuarantine)
    ? (state.activityBridgeQuarantine as ActivityBridgeQuarantine[])
    : [];
  const ids = new Set<string>();
  for (const row of pending) if (!row.kind) ids.add(row.id);
  for (const key of Object.keys(counts)) {
    const parsed = splitActivityBridgeSlot(key);
    if (!parsed.kind) ids.add(parsed.id);
  }
  for (const entry of quarantine) if (!entry.kind) ids.add(entry.id);
  const plans: LegacyBridgeMigration[] = [];
  for (const id of ids) {
    let result: LegacyBridgeClass;
    try {
      result = await classify(id);
    } catch {
      result = 'unknown';
    }
    const attempts = Math.max(counts[id] ?? 0, pending.find((row) => row.id === id && !row.kind)?.attempts ?? 0, 1);
    plans.push({ id, result, attempts });
  }
  applyLegacyMigration(state, plans);
  return plans;
}

/** The next ids a run should retry. They stay in the queue until a later observation settles or counts them. */
export function claimActivityBridgeDrain(
  state: Record<string, unknown>,
  limit = ACTIVITY_BRIDGE_DRAIN_BATCH,
  kind?: ActivityBridgeKind,
): string[] {
  return readPending(state)
    .filter((row) => {
      if (!kind) return true;
      // An old entry has no stream. Neither mail nor calendar may settle it.
      return row.kind === kind;
    })
    .slice(0, limit)
    .map((row) => row.id);
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
  kind?: ActivityBridgeKind,
): Promise<{ hold: boolean; quarantined: string[]; pending: number; backpressure: boolean; failedIds: string[]; settledIds: string[] } | null> {
  const ids = claimActivityBridgeDrain(state, ACTIVITY_BRIDGE_DRAIN_BATCH, kind);
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
  const noted = noteActivityBridgeFailures(state, 'drain', failed, now, settled, false, undefined, kind);
  return { ...noted, failedIds: failed, settledIds: settled };
}

const CURSOR_GROUPS = [
  ['calendarNextLink', 'calendarDeltaLink'],
  ['calendarSyncToken', 'calendarPageToken'],
] as const;

const EMAIL_CURSOR_KEYS = new Set([
  'mailNextLink',
  'mailDeltaLink',
  'mailSentNextLink',
  'mailSentDeltaLink',
  'gmailHistoryId',
  'gmailHistoryPageToken',
  'gmailHistoryResumeCount',
  'gmailListPageToken',
  'gmailListResumeCount',
  'gmailSeedHistoryId',
]);

const CALENDAR_CURSOR_KEYS = new Set([
  'calendarNextLink',
  'calendarDeltaLink',
  'calendarSyncToken',
  'calendarPageToken',
]);

function cursorFamily(key: string): ActivityBridgeKind | undefined {
  if (EMAIL_CURSOR_KEYS.has(key)) return 'email';
  if (CALENDAR_CURSOR_KEYS.has(key)) return 'calendar';
  return undefined;
}

function sameCursorGroup(left: Record<string, unknown>, right: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => samePresence(cursorPresence(left, key), cursorPresence(right, key)));
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
 * `calendarNextLink`/`calendarDeltaLink` and `calendarSyncToken`/`calendarPageToken`
 * are each one cursor. If this run changes either key of a pair, both keys
 * must still match the snapshot, or the locked row must already be the desired
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
  migrations: readonly LegacyBridgeMigration[] = [],
): Record<string, unknown> {
  const result: Record<string, unknown> = structuredClone(stored);
  const retryKeySet = new Set<string>(RETRY_KEYS);
  const groupedKeySet = new Set<string>(CURSOR_GROUPS.flat());
  const keys = new Set([...Object.keys(baseline), ...Object.keys(desired)]);
  const conflicts: string[] = [];
  const writes: string[] = [];
  for (const group of CURSOR_GROUPS) {
    if (sameCursorGroup(baseline, desired, group)) continue;
    if (sameCursorGroup(result, desired, group)) continue;
    if (sameCursorGroup(result, baseline, group)) {
      for (const key of group) {
        if (!samePresence(cursorPresence(baseline, key), cursorPresence(desired, key))) writes.push(key);
      }
    } else {
      conflicts.push(...group);
    }
  }
  for (const key of keys) {
    if (retryKeySet.has(key) || groupedKeySet.has(key)) continue;
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
  const migration = applyLegacyMigration(result, migrations);
  if (migration.refused) {
    const refusedStreams = new Set(migration.streams);
    for (const key of writes) {
      const family = cursorFamily(key);
      if (!family || !refusedStreams.has(family)) continue;
      if (key in stored) result[key] = structuredClone(stored[key]);
      else delete result[key];
    }
  }
  for (const delta of deltas) {
    noteActivityBridgeFailures(
      result,
      delta.page,
      delta.failedIds,
      now,
      delta.settledIds ?? [],
      delta.parkUnseen !== false,
      undefined,
      delta.kind,
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

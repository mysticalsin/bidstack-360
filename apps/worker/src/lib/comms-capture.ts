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
 * How many times one provider item may fail the activity bridge on the same
 * page before it stops pinning that page. The capture row is already saved.
 * The id is kept on `activityBridgeQuarantine` (id, attempts, time — no
 * subject or body). There is no replay worker and no product UI that
 * re-queues a quarantined id; a later provider change starts a fresh budget
 * because it is a new page. The list is the audit, capped so the token
 * cannot grow without bound.
 */
export const ACTIVITY_BRIDGE_RETRY_LIMIT = 3;
const BRIDGE_QUARANTINE_CAP = 50;
const MAX_RETRY_PAGES = 8;
const MAX_IDS_PER_PAGE = 32;

export type ActivityBridgeQuarantine = { id: string; attempts: number; at: string };
export type ActivityBridgeDelta = { page: string; failedIds: string[] };

const RETRY_KEYS = ['activityBridgeRetry', 'activityBridgeRetryByPage', 'activityBridgeQuarantine'] as const;

function readRetryPages(state: Record<string, unknown>): Record<string, Record<string, number>> {
  const pages: Record<string, Record<string, number>> = {};
  const stored = state.activityBridgeRetryByPage;
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    for (const [page, counts] of Object.entries(stored as Record<string, unknown>)) {
      if (!counts || typeof counts !== 'object' || Array.isArray(counts)) continue;
      const next: Record<string, number> = {};
      for (const [id, n] of Object.entries(counts as Record<string, unknown>)) {
        if (typeof n === 'number' && n > 0) next[id] = n;
      }
      if (Object.keys(next).length > 0) pages[page] = next;
    }
  }
  const legacy = state.activityBridgeRetry as { page?: string; counts?: Record<string, number> } | undefined;
  if (legacy?.page && legacy.counts && !pages[legacy.page]) pages[legacy.page] = { ...legacy.counts };
  return pages;
}

function writeRetryPages(state: Record<string, unknown>, pages: Record<string, Record<string, number>>): void {
  delete state.activityBridgeRetry;
  const keys = Object.keys(pages);
  if (keys.length === 0) delete state.activityBridgeRetryByPage;
  else state.activityBridgeRetryByPage = pages;
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
 * Record bridge failures for one page. Other pages on the same token keep
 * their own counts, so Inbox and Sent cannot reset each other. Counts saturate
 * at the limit: a quarantined id does not hold the cursor and does not grow
 * the map. An empty failure list clears only that page.
 */
export function noteActivityBridgeFailures(
  state: Record<string, unknown>,
  page: string,
  failedIds: string[],
  now = new Date().toISOString(),
): { hold: boolean; quarantined: string[] } {
  const ids = [...new Set(failedIds.filter((id) => id.length > 0))];
  const pages = readRetryPages(state);
  if (ids.length === 0) {
    delete pages[page];
    writeRetryPages(state, pages);
    return { hold: false, quarantined: [] };
  }
  const counts = { ...(pages[page] ?? {}) };
  const quarantined: string[] = [];
  for (const id of ids) {
    const attempts = Math.min((counts[id] ?? 0) + 1, ACTIVITY_BRIDGE_RETRY_LIMIT);
    counts[id] = attempts;
    if (attempts >= ACTIVITY_BRIDGE_RETRY_LIMIT) quarantined.push(id);
  }
  const overflow = Object.keys(counts).slice(MAX_IDS_PER_PAGE);
  const overflowEntries: ActivityBridgeQuarantine[] = [];
  for (const id of overflow) {
    overflowEntries.push({ id, attempts: counts[id] ?? 1, at: now });
    delete counts[id];
  }
  const hold = Object.values(counts).some((attempts) => attempts < ACTIVITY_BRIDGE_RETRY_LIMIT);
  delete pages[page];
  pages[page] = counts;
  const dropped: ActivityBridgeQuarantine[] = [];
  while (Object.keys(pages).length > MAX_RETRY_PAGES) {
    const oldest = Object.keys(pages).find((key) => key !== page);
    if (!oldest) break;
    for (const [id, attempts] of Object.entries(pages[oldest] ?? {})) {
      if (attempts < ACTIVITY_BRIDGE_RETRY_LIMIT) dropped.push({ id, attempts, at: now });
    }
    delete pages[oldest];
  }
  writeRetryPages(state, pages);
  const overflowIds = new Set(overflowEntries.map((entry) => entry.id));
  quarantineIds(state, [
    ...quarantined
      .filter((id) => !overflowIds.has(id))
      .map((id) => ({ id, attempts: counts[id] ?? ACTIVITY_BRIDGE_RETRY_LIMIT, at: now })),
    ...overflowEntries,
    ...dropped,
  ]);
  return {
    hold,
    quarantined: [
      ...quarantined.filter((id) => !overflowIds.has(id)),
      ...overflowEntries.map((entry) => entry.id),
    ],
  };
}

/**
 * Build the token delta to persist. Cursor fields come from this run.
 * Retry counts and the quarantine list are taken from the stored token and
 * then each of this run's page deltas is applied once, so a concurrent
 * writer cannot be overwritten by a stale copy of the map.
 */
export function mergeBridgeDeltaState(
  stored: Record<string, unknown>,
  desired: Record<string, unknown>,
  deltas: ActivityBridgeDelta[],
  now = new Date().toISOString(),
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...desired };
  for (const key of RETRY_KEYS) delete result[key];
  for (const key of RETRY_KEYS) {
    if (key in stored) result[key] = structuredClone(stored[key]);
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

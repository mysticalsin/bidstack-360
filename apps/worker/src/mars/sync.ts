/**
 * MARS sync (job `meeting-intel.mars-sync`). Off unless
 * MARS_INTEGRATION_ENABLED=true.
 *
 *  1. Load the org's MARS connection (created by an admin from the API).
 *  2. Page through MARS from the stored cursor (or lastSyncAt the first time),
 *     saving the cursor after every page so a crash resumes, not restarts.
 *  3. Per entry: validate, honour confidential and tombstones, match the
 *     client company to ONE Polo account (strict), map to NormalizedMeeting
 *     and hand it to the shared storeIngestItems, so matching contacts,
 *     seniority, dedupe across ABC/Metis/MARS and cross-region flags run
 *     exactly as for the other sources.
 *  4. Unmatched or ambiguous entries are kept as `unmatched` ingest items with
 *     only id, title and client name, for an admin to map.
 *
 * Idempotent: the ingest item is unique per (org, source, externalId) and the
 * externalId is entryId:vN, so replaying a page is a no-op. An edit in MARS is
 * a new version: same title and day merges into the existing meeting; a moved
 * or retitled entry replaces the older MARS-only meeting.
 */
import { Prisma, prisma } from '@bidstack/db';
import {
  emailDomain,
  isMarsEnabled,
  MarsEntry,
  type MarsAccountCandidate,
  matchMarsAccount,
  type MeetingIntelJob,
  normalizeMeetingTitle,
} from '@bidstack/shared';

import { storeIngestItems } from '../meeting-intel/pipeline.js';

import { type MarsClient, MarsNotConfiguredError } from './client.js';
import { mapMarsEntry, marsEntryIdOf, marsExternalId } from './map.js';

export interface MarsSyncDeps {
  client: MarsClient;
  enqueue: (job: MeetingIntelJob) => Promise<void>;
  now: () => Date;
  enabled: boolean;
  pageSize: number;
  maxPages: number;
  webBaseUrl: string | null;
}

export function marsSyncDepsFromEnv(client: MarsClient, enqueue: MarsSyncDeps['enqueue'], env: NodeJS.ProcessEnv = process.env): MarsSyncDeps {
  const int = (v: string | undefined, d: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= min ? Math.min(max, Math.floor(n)) : d;
  };
  return {
    client,
    enqueue,
    now: () => new Date(),
    enabled: isMarsEnabled(env.MARS_INTEGRATION_ENABLED),
    pageSize: int(env.MARS_PAGE_SIZE, 100, 1, 500),
    maxPages: int(env.MARS_MAX_PAGES_PER_RUN, 20, 1, 200),
    webBaseUrl: env.MARS_WEB_BASE_URL?.trim() || null,
  };
}

export interface MarsSyncResult {
  outcome: 'disabled' | 'no_connection' | 'not_configured' | 'done';
  pages: number;
  pulled: number;
  stored: number;
  refused: number;
  unmatched: number;
  ambiguous: number;
  tombstoned: number;
  superseded: number;
  hasMore: boolean;
}

const empty = (outcome: MarsSyncResult['outcome']): MarsSyncResult => ({
  outcome, pages: 0, pulled: 0, stored: 0, refused: 0, unmatched: 0, ambiguous: 0, tombstoned: 0, superseded: 0, hasMore: false,
});

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/** Meetings fed only by MARS links of this entry. Meetings that ABC or Metis also fed are never removed. */
async function marsOnlyMeetings(orgId: string, entryId: string, keepExternalId: string | null) {
  const links = await prisma.meetingIntelSourceLink.findMany({
    where: { orgId, source: 'mars', externalId: { startsWith: `${entryId}:v` }, ...(keepExternalId ? { NOT: { externalId: keepExternalId } } : {}) },
    select: { meetingId: true },
    take: 50,
  });
  const ids = [...new Set(links.map((l) => l.meetingId))];
  if (!ids.length) return [];
  const meetings = await prisma.meetingIntel.findMany({
    where: { orgId, id: { in: ids }, deletedAt: null },
    select: { id: true, title: true, heldAt: true, sources: { select: { source: true, externalId: true } } },
  });
  return meetings.filter((m) => m.sources.every((s) => s.source === 'mars' && marsEntryIdOf(s.externalId) === entryId));
}

async function archiveMeeting(orgId: string, meetingId: string, now: Date) {
  await prisma.$transaction([
    prisma.meetingIntel.update({ where: { id: meetingId }, data: { deletedAt: now } }),
    prisma.meetingCrossRegionFlag.updateMany({ where: { orgId, meetingId, status: 'open' }, data: { status: 'dismissed', dismissedAt: now } }),
  ]);
}

export async function runMarsSync(job: { orgId: string; reason?: string }, deps: MarsSyncDeps): Promise<MarsSyncResult> {
  if (!deps.enabled) return empty('disabled');
  const conn = await prisma.meetingSourceConnection.findFirst({
    where: { orgId: job.orgId, source: 'mars', status: 'connected' },
    orderBy: { createdAt: 'asc' },
  });
  if (!conn) return empty('no_connection');
  if (!deps.client.configured) {
    await prisma.meetingSourceConnection.update({ where: { id: conn.id }, data: { lastError: 'not_configured' } });
    return empty('not_configured');
  }

  const [companies, users] = await Promise.all([
    prisma.company.findMany({
      where: { orgId: job.orgId, deletedAt: null },
      select: { id: true, name: true, legalName: true, domain: true, parentId: true },
      take: 5000,
    }),
    prisma.user.findMany({ where: { orgId: job.orgId, deletedAt: null }, select: { id: true, email: true }, take: 5000 }),
  ]);
  const accounts: MarsAccountCandidate[] = companies.map((c) => ({ companyId: c.id, name: c.name, legalName: c.legalName, domain: c.domain, parentId: c.parentId }));
  const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));
  const ownDomains = new Set(users.map((u) => emailDomain(u.email)).filter((d): d is string => !!d));

  const res = empty('done');
  let cursor = conn.syncCursor;
  const since = cursor ? null : conn.lastSyncAt;
  const startedAt = deps.now();
  try {
    for (let page = 0; page < deps.maxPages; page++) {
      const p = await deps.client.listEntries({ cursor, updatedSince: since, limit: deps.pageSize });
      res.pages++;
      res.pulled += p.items.length;
      for (const raw of p.items) {
        const parsed = MarsEntry.safeParse(raw);
        if (!parsed.success) {
          res.refused++;
          continue;
        }
        const e = parsed.data;
        if (e.deleted) {
          for (const m of await marsOnlyMeetings(job.orgId, e.id, null)) {
            await archiveMeeting(job.orgId, m.id, deps.now());
            res.tombstoned++;
          }
          continue;
        }
        if (e.confidential) {
          res.refused++;
          continue;
        }
        const match = matchMarsAccount(e.client, accounts, { contactEmails: e.contacts.map((c) => c.email), ownDomains });
        if (match.companyId === null) {
          if (match.reason === 'ambiguous') res.ambiguous++;
          else res.unmatched++;
          await prisma.meetingIngestItem.createMany({
            data: [{
              orgId: job.orgId,
              source: 'mars',
              externalId: marsExternalId(e),
              connectionId: conn.id,
              submittedById: null,
              status: 'unmatched',
              error: match.reason,
              payload: { externalId: marsExternalId(e), title: e.topic ?? e.client.name, accountName: e.client.name, candidates: match.candidates },
              processedAt: deps.now(),
            }],
            skipDuplicates: true,
          });
          continue;
        }
        const meeting = mapMarsEntry(e, match.companyId, { webBaseUrl: deps.webBaseUrl });
        if (e.version > 1) {
          const key = `${normalizeMeetingTitle(meeting.title)}|${utcDay(new Date(meeting.heldAt))}`;
          for (const m of await marsOnlyMeetings(job.orgId, e.id, meeting.externalId)) {
            if (`${normalizeMeetingTitle(m.title)}|${utcDay(m.heldAt)}` === key) continue; // merges in place
            await archiveMeeting(job.orgId, m.id, deps.now());
            res.superseded++;
          }
        }
        const stored = await storeIngestItems(
          job.orgId,
          { source: 'mars', connectionId: conn.id, submittedById: userByEmail.get(e.loggedBy.email) ?? null, shareSummary: true, shareTranscript: false },
          [meeting],
          deps,
        );
        res.stored += stored.stored;
        res.refused += stored.refused;
      }
      cursor = p.nextCursor ?? cursor;
      await prisma.meetingSourceConnection.update({
        where: { id: conn.id },
        data: { syncCursor: cursor, itemsReceived: { increment: p.items.length } },
      });
      res.hasMore = p.hasMore;
      if (!p.hasMore) break;
    }
  } catch (err) {
    const message = err instanceof MarsNotConfiguredError ? 'not_configured' : (err as Error).message.slice(0, 500);
    await prisma.meetingSourceConnection.update({ where: { id: conn.id }, data: { lastError: message } });
    throw err;
  }
  await prisma.meetingSourceConnection.update({ where: { id: conn.id }, data: { lastSyncAt: startedAt, lastError: null } });
  // More pages than one run may take: continue right away.
  if (res.hasMore) await deps.enqueue({ kind: 'mars-sync', orgId: job.orgId, reason: 'schedule' });
  await prisma.auditLog.create({
    data: { orgId: job.orgId, userId: null, action: 'meeting_intel.source.sync', targetType: 'meeting_intel', targetId: conn.id, diff: { source: 'mars', reason: job.reason ?? 'schedule', ...res } as unknown as Prisma.InputJsonValue },
  });
  return res;
}

/** Orgs with a connected MARS source, for the scheduled scan. */
export async function marsOrgsToSync(): Promise<string[]> {
  const rows = await prisma.meetingSourceConnection.findMany({ where: { source: 'mars', status: 'connected' }, select: { orgId: true }, distinct: ['orgId'], take: 1000 });
  return rows.map((r) => r.orgId);
}

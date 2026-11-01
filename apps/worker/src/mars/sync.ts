/**
 * MARS sync (job `meeting-intel.mars-sync`). Off unless
 * MARS_INTEGRATION_ENABLED=true.
 *
 *  1. Load the org's MARS connection (created by an admin from the API).
 *  2. Page through MARS from the stored cursor (or lastSyncAt the first time),
 *     saving the cursor after every page so a crash resumes, not restarts.
 *     Account scoped sources (Power BI) are queried once per account in the
 *     admin-confirmed key map (settings.accountKeys), each account with its
 *     own watermark in settings.cursors, so a newly mapped account backfills
 *     on its own without replaying the others.
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
import { type Prisma, prisma } from '@bidstack/db';
import {
  emailDomain,
  isMarsEnabled,
  MarsEntry,
  type MarsAccountCandidate,
  matchMarsAccount,
  type MeetingIntelJob,
  normalizeMarsAccountKey,
  normalizeMeetingTitle,
  parseMarsSettings,
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
  /** Account scoped sources (Power BI): queries per run across all accounts. */
  maxQueries: number;
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
    maxQueries: int(env.MARS_MAX_QUERIES_PER_RUN, 100, 1, 1000),
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
  source?: string;
  /** Account scoped sources: mapped accounts this run looked at. */
  accounts?: number;
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
    prisma.user.findMany({ where: { orgId: job.orgId, deletedAt: null }, select: { id: true, email: true, name: true }, take: 5000 }),
  ]);
  const settings = parseMarsSettings(conn.settings);
  const liveIds = new Set(companies.map((c) => c.id));
  const keyMap = Object.fromEntries(Object.entries(settings.accountKeys).filter(([id]) => liveIds.has(id)));
  const allKeys = Object.values(keyMap).flat();
  // One candidate per confirmed key, so the strict mars_id rule sees every key; unmapped accounts keep the other strict rules.
  const accounts: MarsAccountCandidate[] = companies.flatMap((c) => {
    const base = { companyId: c.id, name: c.name, legalName: c.legalName, domain: c.domain, parentId: c.parentId };
    const keys = keyMap[c.id] ?? [];
    return keys.length ? keys.map((k) => ({ ...base, marsAccountId: k })) : [base];
  });
  const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));
  const ownDomains = new Set(users.map((u) => emailDomain(u.email)).filter((d): d is string => !!d));
  // Tabular extracts often name colleagues without an email: resolve a UNIQUE exact name to the Polo user.
  const nameKey = (n: string) => n.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
  const emailByName = new Map<string, string | null>();
  for (const u of users) {
    if (!u.name) continue;
    const k = nameKey(u.name);
    emailByName.set(k, emailByName.has(k) ? null : u.email.toLowerCase());
  }
  const withEmail = <T extends { name: string; email?: string | null }>(p: T): T => (p.email ? p : { ...p, email: emailByName.get(nameKey(p.name)) ?? null });

  const res = empty('done');
  res.source = deps.client.kind ?? 'api';
  const startedAt = deps.now();

  async function ingest(raw: unknown, scoped: { companyId: string; keys: readonly string[] } | null) {
    const parsed = MarsEntry.safeParse(raw);
    if (!parsed.success) {
      res.refused++;
      return;
    }
    const e = { ...parsed.data, loggedBy: withEmail(parsed.data.loggedBy), internalAttendees: parsed.data.internalAttendees.map(withEmail) };
    if (e.deleted) {
      for (const m of await marsOnlyMeetings(job.orgId, e.id, null)) {
        await archiveMeeting(job.orgId, m.id, deps.now());
        res.tombstoned++;
      }
      return;
    }
    if (e.confidential) {
      res.refused++;
      return;
    }
    let companyId: string | null;
    let reason: 'no_match' | 'ambiguous' = 'no_match';
    let candidates: string[] = [];
    if (scoped) {
      // The query was filtered on this account's keys; check again here, whole value only.
      const k = normalizeMarsAccountKey(e.client.marsAccountId);
      companyId = k && scoped.keys.some((x) => normalizeMarsAccountKey(x) === k) ? scoped.companyId : null;
      if (!companyId) {
        res.refused++;
        return;
      }
    } else {
      const match = matchMarsAccount(e.client, accounts, { contactEmails: e.contacts.map((c) => c.email), ownDomains });
      companyId = match.companyId;
      if (match.companyId === null) ({ reason, candidates } = match);
    }
    if (companyId === null) {
      if (reason === 'ambiguous') res.ambiguous++;
      else res.unmatched++;
      await prisma.meetingIngestItem.createMany({
        data: [{
          orgId: job.orgId,
          source: 'mars',
          externalId: marsExternalId(e),
          connectionId: conn!.id,
          submittedById: null,
          status: 'unmatched',
          error: reason,
          payload: { externalId: marsExternalId(e), title: e.topic ?? e.client.name, accountName: e.client.name, candidates },
          processedAt: deps.now(),
        }],
        skipDuplicates: true,
      });
      return;
    }
    const meeting = mapMarsEntry(e, companyId, { webBaseUrl: deps.webBaseUrl });
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
      { source: 'mars', connectionId: conn!.id, submittedById: (e.loggedBy.email && userByEmail.get(e.loggedBy.email)) || null, shareSummary: true, shareTranscript: false },
      [meeting],
      deps,
    );
    res.stored += stored.stored;
    res.refused += stored.refused;
  }

  try {
    if (deps.client.scope === 'account') {
      // Power BI: one query per mapped account, each with its own watermark. Accounts never queried go first.
      const mapped = Object.entries(keyMap).sort(([a], [b]) => (settings.cursors[a] ?? '').localeCompare(settings.cursors[b] ?? ''));
      res.accounts = mapped.length;
      let budget = deps.maxQueries;
      outer: for (const [companyId, keys] of mapped) {
        let cursor = settings.cursors[companyId] ?? null;
        for (;;) {
          if (budget-- <= 0) {
            res.hasMore = true;
            break outer;
          }
          const p = await deps.client.listEntries({ cursor, updatedSince: null, limit: deps.pageSize, accountKeys: keys });
          res.pages++;
          res.pulled += p.items.length;
          for (const raw of p.items) await ingest(raw, { companyId, keys });
          cursor = p.nextCursor ?? cursor;
          if (cursor) await saveAccountCursor(conn.id, companyId, cursor, p.items.length);
          if (!p.hasMore) break;
        }
      }
    } else {
      let cursor = conn.syncCursor;
      const since = cursor ? null : conn.lastSyncAt;
      for (let page = 0; page < deps.maxPages; page++) {
        const p = await deps.client.listEntries({ cursor, updatedSince: since, limit: deps.pageSize, accountKeys: allKeys });
        res.pages++;
        res.pulled += p.items.length;
        for (const raw of p.items) await ingest(raw, null);
        cursor = p.nextCursor ?? cursor;
        await prisma.meetingSourceConnection.update({
          where: { id: conn.id },
          data: { syncCursor: cursor, itemsReceived: { increment: p.items.length } },
        });
        res.hasMore = p.hasMore;
        if (!p.hasMore) break;
      }
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

/** Writes only settings.cursors[companyId], so an admin editing the key map at the same time is not overwritten. */
async function saveAccountCursor(connectionId: string, companyId: string, cursor: string, items: number) {
  await prisma.$executeRaw`
    UPDATE "meeting_source_connections"
    SET "settings" = COALESCE("settings", '{}'::jsonb)
          || jsonb_build_object('cursors', COALESCE("settings"->'cursors', '{}'::jsonb) || jsonb_build_object(${companyId}::text, ${cursor}::text)),
        "items_received" = "items_received" + ${items},
        "updated_at" = NOW()
    WHERE "id" = ${connectionId}::uuid`;
}

/** Orgs with a connected MARS source, for the scheduled scan. */
export async function marsOrgsToSync(): Promise<string[]> {
  const rows = await prisma.meetingSourceConnection.findMany({ where: { source: 'mars', status: 'connected' }, select: { orgId: true }, distinct: ['orgId'], take: 1000 });
  return rows.map((r) => r.orgId);
}

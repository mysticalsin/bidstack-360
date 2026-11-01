/**
 * Meeting intel pipeline (queue `meeting-intel`).
 *
 *   sync:    pull one source connection through its adapter, apply the
 *            connection's consent, store new items, enqueue one process job each.
 *   process: match the meeting to a Polo account and contacts, classify
 *            attendee seniority, dedupe across sources (one meeting, many
 *            source links), then raise cross-region flags on strategic accounts.
 *
 * Unmatched meetings are not kept: their payload is wiped to the external id
 * and title, since Metis users only share meetings for accounts in Polo.
 * Payload ids are never trusted: every read is filtered by orgId.
 */
import { createHash } from 'node:crypto';

import { Prisma, prisma } from '@bidstack/db';
import {
  applyMeetingConsent,
  classifySeniority,
  crossRegionTalkingPoints,
  emailDomain,
  meetingDedupeMaterial,
  type MeetingIntelJob,
  NormalizedMeeting,
  type SeniorityLevel,
  seniorityRank,
  ACCOUNT_TEAM_OPEN_STAGES,
} from '@bidstack/shared';

import { type AccountHint, type AdapterRegistry, defaultAdapters, SourceNotConfiguredError } from './adapters.js';

export interface PipelineDeps {
  adapters: AdapterRegistry;
  enqueue: (job: MeetingIntelJob) => Promise<void>;
  now: () => Date;
}

const MAX_ACCOUNT_HINTS = 2000;
const MAX_GROUP_COMPANIES = 500;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const norm = (s: string | null | undefined) =>
  (s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(sa|sas|ag|gmbh|ltd|inc|plc|group|groupe)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// ─── sync ───────────────────────────────────────────────────────────────────

export async function syncConnection(
  job: { orgId: string; connectionId: string },
  deps: PipelineDeps,
): Promise<{ pulled: number; stored: number; refused: number; outcome: string }> {
  const conn = await prisma.meetingSourceConnection.findFirst({
    where: { id: job.connectionId, orgId: job.orgId, status: 'connected', source: { in: ['abc', 'metis'] } },
  });
  if (!conn) return { pulled: 0, stored: 0, refused: 0, outcome: 'skipped' };
  const adapter = deps.adapters[conn.source as 'abc' | 'metis'];
  const companies = await prisma.company.findMany({
    where: { orgId: job.orgId, deletedAt: null },
    select: { id: true, name: true, domain: true },
    orderBy: { name: 'asc' },
    take: MAX_ACCOUNT_HINTS,
  });
  const accounts: AccountHint[] = companies.map((c) => ({ companyId: c.id, name: c.name, domain: c.domain, abcExternalId: null }));
  const startedAt = deps.now();
  let meetings;
  try {
    meetings = await adapter.pull({
      orgId: job.orgId,
      userId: conn.userId,
      since: conn.lastSyncAt,
      accounts,
      includeTranscript: conn.source === 'metis' && conn.shareTranscript,
    });
  } catch (err) {
    const message = err instanceof SourceNotConfiguredError ? 'not_configured' : (err as Error).message.slice(0, 500);
    await prisma.meetingSourceConnection.update({ where: { id: conn.id }, data: { lastError: message } });
    if (err instanceof SourceNotConfiguredError) return { pulled: 0, stored: 0, refused: 0, outcome: 'not_configured' };
    throw err;
  }
  const res = await storeIngestItems(
    job.orgId,
    { source: conn.source, connectionId: conn.id, submittedById: conn.userId, shareSummary: conn.shareSummary, shareTranscript: conn.shareTranscript },
    meetings,
    deps,
  );
  await prisma.meetingSourceConnection.update({
    where: { id: conn.id },
    data: { lastSyncAt: startedAt, lastError: null, itemsReceived: { increment: res.stored } },
  });
  return { pulled: meetings.length, ...res, outcome: 'done' };
}

/** Shared by pull sync (worker) and push/manual ingest (API, same rules). */
export async function storeIngestItems(
  orgId: string,
  conn: {
    source: 'abc' | 'metis' | 'manual' | 'mars';
    connectionId: string | null;
    submittedById: string | null;
    shareSummary: boolean;
    shareTranscript: boolean;
  },
  meetings: unknown[],
  deps: Pick<PipelineDeps, 'enqueue'>,
): Promise<{ stored: number; refused: number }> {
  let stored = 0;
  let refused = 0;
  for (const raw of meetings) {
    const parsed = NormalizedMeeting.safeParse(raw);
    if (!parsed.success) {
      refused++;
      continue;
    }
    const consent = applyMeetingConsent(parsed.data, conn);
    if (!consent.ok) {
      refused++;
      continue;
    }
    try {
      const item = await prisma.meetingIngestItem.create({
        data: {
          orgId,
          source: conn.source,
          externalId: consent.meeting.externalId,
          connectionId: conn.connectionId,
          submittedById: conn.submittedById,
          payload: consent.meeting as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      stored++;
      await deps.enqueue({ kind: 'process', orgId, itemId: item.id });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue; // already ingested
      throw err;
    }
  }
  return { stored, refused };
}

// ─── process ────────────────────────────────────────────────────────────────

type CompanyLite = { id: string; name: string; legalName: string | null; domain: string | null; countryCode: string | null };

async function matchCompany(orgId: string, m: NormalizedMeeting, orgUserDomains: Set<string>): Promise<CompanyLite | null> {
  const select = { id: true, name: true, legalName: true, domain: true, countryCode: true } as const;
  if (m.companyId) {
    return prisma.company.findFirst({ where: { id: m.companyId, orgId, deletedAt: null }, select });
  }
  if (m.accountName) {
    const wanted = norm(m.accountName);
    const candidates = await prisma.company.findMany({
      where: {
        orgId,
        deletedAt: null,
        OR: [
          { name: { contains: m.accountName.slice(0, 60), mode: 'insensitive' } },
          { legalName: { contains: m.accountName.slice(0, 60), mode: 'insensitive' } },
          { name: { equals: m.accountName, mode: 'insensitive' } },
        ],
      },
      select,
      take: 20,
    });
    const exact = candidates.filter((c) => norm(c.name) === wanted || norm(c.legalName) === wanted);
    if (exact.length === 1) return exact[0]!;
  }
  const domains = [
    ...new Set(m.attendees.map((a) => emailDomain(a.email)).filter((d): d is string => !!d && !orgUserDomains.has(d))),
  ];
  if (domains.length) {
    const byDomain = await prisma.company.findMany({
      where: { orgId, deletedAt: null, domain: { in: domains.flatMap((d) => [d, `www.${d}`]), mode: 'insensitive' } },
      select,
      take: 5,
    });
    if (byDomain.length === 1) return byDomain[0]!;
  }
  return null;
}

async function orgUsers(orgId: string) {
  const users = await prisma.user.findMany({
    where: { orgId, deletedAt: null },
    select: { id: true, email: true },
    take: 5000,
  });
  const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));
  const domains = new Set(users.map((u) => emailDomain(u.email)).filter((d): d is string => !!d));
  return { byEmail, domains };
}

export async function processIngestItem(
  job: { orgId: string; itemId: string },
  deps: PipelineDeps,
): Promise<{ outcome: 'created' | 'merged' | 'unmatched' | 'skipped' | 'invalid'; meetingId?: string; flags?: number }> {
  const item = await prisma.meetingIngestItem.findFirst({ where: { id: job.itemId, orgId: job.orgId } });
  if (!item || item.status !== 'pending') return { outcome: 'skipped' };
  const parsed = NormalizedMeeting.safeParse(item.payload);
  if (!parsed.success) {
    await prisma.meetingIngestItem.update({
      where: { id: item.id },
      data: { status: 'error', error: 'invalid payload', payload: {}, processedAt: deps.now() },
    });
    return { outcome: 'invalid' };
  }
  const m = parsed.data;
  const users = await orgUsers(job.orgId);
  const company = await matchCompany(job.orgId, m, users.domains);
  if (!company) {
    await prisma.meetingIngestItem.update({
      where: { id: item.id },
      data: { status: 'unmatched', payload: { externalId: m.externalId, title: m.title }, processedAt: deps.now() },
    });
    return { outcome: 'unmatched' };
  }

  // Attendees: internal users, then contacts by email, then by name within the account.
  const emails = m.attendees.map((a) => a.email?.toLowerCase()).filter((e): e is string => !!e);
  const contacts = await prisma.contact.findMany({
    where: {
      orgId: job.orgId,
      deletedAt: null,
      OR: [
        ...(emails.length ? [{ email: { in: emails } }] : []),
        { companyId: company.id, name: { in: m.attendees.map((a) => a.name) } },
      ],
    },
    select: { id: true, email: true, name: true, role: true, companyId: true },
    take: 500,
  });
  const contactByEmail = new Map(contacts.filter((c) => c.email).map((c) => [c.email!.toLowerCase(), c]));
  const contactByName = new Map(contacts.filter((c) => c.companyId === company.id).map((c) => [norm(c.name), c]));
  const attendees = m.attendees.map((a) => {
    const email = a.email?.toLowerCase() ?? null;
    const userId = email ? (users.byEmail.get(email) ?? null) : null;
    const contact = userId ? null : ((email ? contactByEmail.get(email) : undefined) ?? contactByName.get(norm(a.name)) ?? null);
    const isInternal = !!userId || (!!email && users.domains.has(emailDomain(email)!));
    return {
      orgId: job.orgId,
      contactId: contact?.id ?? null,
      userId,
      name: a.name,
      email,
      title: a.title ?? contact?.role ?? null,
      seniority: (isInternal ? 'unknown' : classifySeniority(a.title ?? contact?.role)) as SeniorityLevel,
      region: a.region ?? (isInternal ? null : company.countryCode),
      businessUnit: a.businessUnit ?? null,
      isInternal,
    };
  });

  const heldAt = new Date(m.heldAt);
  const material = meetingDedupeMaterial({
    orgId: job.orgId,
    companyId: company.id,
    heldAt,
    title: m.title,
    attendeeEmails: attendees.filter((a) => !a.isInternal && a.email).map((a) => a.email!),
  });
  const titleKey = sha(material.byTitle);
  const existing = await findDuplicate(job.orgId, company.id, heldAt, titleKey, attendees);

  let meetingId: string;
  let outcome: 'created' | 'merged';
  if (existing) {
    outcome = 'merged';
    meetingId = existing.id;
    const union = (a: string[], b: string[]) => [...new Set([...a, ...b])].slice(0, 30);
    await prisma.$transaction(async (tx) => {
      await tx.meetingIntel.update({
        where: { id: existing.id },
        data: {
          summary: existing.summary ?? m.summary ?? null,
          transcriptText: existing.transcriptText ?? m.transcript ?? null,
          challenges: union(existing.challenges, m.challenges),
          similarProjects: union(existing.similarProjects, m.similarProjects),
          opportunities: union(existing.opportunities, m.opportunities),
          nextSteps: union(existing.nextSteps, m.nextSteps),
        },
      });
      await tx.meetingIntelSourceLink.createMany({
        data: [{ orgId: job.orgId, meetingId: existing.id, source: item.source, externalId: m.externalId, url: m.url ?? null, connectionUserId: item.submittedById }],
        skipDuplicates: true,
      });
      const have = await tx.meetingIntelAttendee.findMany({ where: { meetingId: existing.id }, select: { email: true, name: true }, take: 500 });
      const seen = new Set(have.map((h) => h.email?.toLowerCase() ?? `n:${norm(h.name)}`));
      const fresh = attendees.filter((a) => !seen.has(a.email ?? `n:${norm(a.name)}`));
      if (fresh.length) await tx.meetingIntelAttendee.createMany({ data: fresh.map((a) => ({ ...a, meetingId: existing.id })) });
    });
  } else {
    outcome = 'created';
    const created = await prisma.meetingIntel.create({
      data: {
        orgId: job.orgId,
        companyId: company.id,
        title: m.title,
        heldAt,
        visibility: m.visibility ?? 'account_team',
        summary: m.summary ?? null,
        transcriptText: m.transcript ?? null,
        challenges: m.challenges,
        similarProjects: m.similarProjects,
        opportunities: m.opportunities,
        nextSteps: m.nextSteps,
        dedupeKey: titleKey,
        createdById: item.submittedById,
        sources: { create: [{ orgId: job.orgId, source: item.source, externalId: m.externalId, url: m.url ?? null, connectionUserId: item.submittedById }] },
        attendees: { create: attendees.map(({ orgId: _o, ...a }) => ({ orgId: job.orgId, ...a })) },
      },
      select: { id: true },
    });
    meetingId = created.id;
  }

  // The transcript now lives on the meeting (with consent); drop the copy.
  const { transcript: _t, ...slim } = m;
  await prisma.meetingIngestItem.update({
    where: { id: item.id },
    data: { status: 'processed', meetingIntelId: meetingId, payload: slim as unknown as Prisma.InputJsonValue, processedAt: deps.now() },
  });
  const flags = await raiseCrossRegionFlags(job.orgId, meetingId);
  return { outcome, meetingId, flags };
}

async function findDuplicate(
  orgId: string,
  companyId: string,
  heldAt: Date,
  titleKey: string,
  attendees: Array<{ email: string | null; isInternal: boolean }>,
) {
  const byTitle = await prisma.meetingIntel.findFirst({ where: { orgId, dedupeKey: titleKey, deletedAt: null } });
  if (byTitle) return byTitle;
  const ext = new Set(attendees.filter((a) => !a.isInternal && a.email).map((a) => a.email!));
  if (ext.size < 2) return null;
  const day = new Date(Date.UTC(heldAt.getUTCFullYear(), heldAt.getUTCMonth(), heldAt.getUTCDate()));
  const sameDay = await prisma.meetingIntel.findMany({
    where: { orgId, companyId, deletedAt: null, heldAt: { gte: day, lt: new Date(day.getTime() + 86_400_000) } },
    include: { attendees: { where: { isInternal: false }, select: { email: true } } },
    take: 50,
  });
  for (const cand of sameDay) {
    const theirs = new Set(cand.attendees.map((a) => a.email?.toLowerCase()).filter(Boolean));
    if (theirs.size === ext.size && [...ext].every((e) => theirs.has(e))) {
      const { attendees: _a, ...row } = cand;
      return row;
    }
  }
  return null;
}

// ─── cross-region flags ─────────────────────────────────────────────────────

const OPEN_STAGES = ACCOUNT_TEAM_OPEN_STAGES;

/** Account team of a company: key account owner, director sponsor, open-deal owners. */
export async function accountTeams(orgId: string, companyIds: string[]): Promise<Map<string, Set<string>>> {
  const teams = new Map<string, Set<string>>(companyIds.map((id) => [id, new Set<string>()]));
  if (!companyIds.length) return teams;
  const [companies, opps] = await Promise.all([
    prisma.company.findMany({
      where: { orgId, id: { in: companyIds } },
      select: { id: true, keyAccountOwnerId: true, directorSponsorId: true },
      take: MAX_GROUP_COMPANIES,
    }),
    prisma.opportunity.findMany({
      where: { orgId, companyId: { in: companyIds }, deletedAt: null, stage: { in: [...OPEN_STAGES] }, ownerId: { not: null } },
      select: { companyId: true, ownerId: true },
      take: 5000,
    }),
  ]);
  for (const c of companies) {
    if (c.keyAccountOwnerId) teams.get(c.id)!.add(c.keyAccountOwnerId);
    if (c.directorSponsorId) teams.get(c.id)!.add(c.directorSponsorId);
  }
  for (const o of opps) if (o.companyId && o.ownerId) teams.get(o.companyId)?.add(o.ownerId);
  return teams;
}

/** Root of the company hierarchy plus every descendant (bounded). */
export async function companyGroup(orgId: string, companyId: string) {
  const sel = { id: true, name: true, parentId: true, tier: true, countryCode: true, keyAccountOwnerId: true } as const;
  let node = await prisma.company.findFirst({ where: { id: companyId, orgId, deletedAt: null }, select: sel });
  if (!node) return null;
  const chain = [node];
  for (let i = 0; i < 10 && node?.parentId; i++) {
    node = await prisma.company.findFirst({ where: { id: node.parentId, orgId, deletedAt: null }, select: sel });
    if (node) chain.push(node);
  }
  const root = chain[chain.length - 1]!;
  const members = [root];
  let frontier = [root.id];
  while (frontier.length && members.length < MAX_GROUP_COMPANIES) {
    const kids = await prisma.company.findMany({
      where: { orgId, deletedAt: null, parentId: { in: frontier } },
      select: sel,
      take: MAX_GROUP_COMPANIES - members.length,
    });
    members.push(...kids);
    frontier = kids.map((k) => k.id);
  }
  return { root, members, strategic: chain.some((c) => c.tier === 'key' || c.tier === 'top') };
}

/** Simplified mirror of the API company scope, used only to redact notification text. */
async function userCanSeeCompany(orgId: string, userId: string, c: { id: string; countryCode: string | null; keyAccountOwnerId: string | null }) {
  const groups = await prisma.userGroupMember.findMany({
    where: { orgId, userId, group: { deletedAt: null } },
    select: { group: { select: { scopeAll: true, scopeCountries: true } } },
    take: 100,
  });
  if (!groups.length || groups.some((g) => g.group.scopeAll)) return true;
  if (c.keyAccountOwnerId === userId) return true;
  const countries = new Set(groups.flatMap((g) => g.group.scopeCountries.map((x) => x.toUpperCase())));
  if (c.countryCode && countries.has(c.countryCode.toUpperCase())) return true;
  const own = await prisma.opportunity.count({ where: { orgId, companyId: c.id, ownerId: userId, deletedAt: null } });
  return own > 0;
}

export async function raiseCrossRegionFlags(orgId: string, meetingId: string): Promise<number> {
  const meeting = await prisma.meetingIntel.findFirst({
    where: { id: meetingId, orgId, deletedAt: null },
    include: { attendees: { select: { seniority: true, isInternal: true, region: true, businessUnit: true } } },
  });
  if (!meeting) return 0;
  const group = await companyGroup(orgId, meeting.companyId);
  if (!group || !group.strategic || group.members.length < 2) return 0;
  const here = group.members.find((c) => c.id === meeting.companyId)!;
  const others = group.members.filter((c) => c.id !== meeting.companyId);
  const teams = await accountTeams(orgId, group.members.map((c) => c.id));
  const hereTeam = new Set([...(teams.get(here.id) ?? []), ...(meeting.createdById ? [meeting.createdById] : [])]);
  const external = meeting.attendees.filter((a) => !a.isInternal);
  const top = external.reduce<SeniorityLevel>((best, a) => (seniorityRank(a.seniority) < seniorityRank(best) ? a.seniority : best), 'unknown');
  const meetingRegion = here.countryCode ?? external.find((a) => a.region)?.region ?? here.name;

  let created = 0;
  for (const other of others) {
    const ownedRegion = other.countryCode ?? other.name;
    // A same-country sibling is another BU of the parent, so it is flagged too.
    for (const userId of teams.get(other.id) ?? []) {
      if (hereTeam.has(userId)) continue;
      const restricted = !(await userCanSeeCompany(orgId, userId, here));
      const talkingPoints = crossRegionTalkingPoints({
        parentName: group.root.name,
        meetingRegion,
        ownedRegion,
        topSeniority: top,
        challenges: meeting.challenges,
        opportunities: meeting.opportunities,
        restricted,
      });
      const reason = restricted
        ? `You cover ${other.name}. A colleague met ${group.root.name} in another region.`
        : `You cover ${other.name}. ${meeting.title} took place at ${here.name} (${meetingRegion}).`;
      const res = await prisma.meetingCrossRegionFlag.createMany({
        data: [
          {
            orgId,
            meetingId,
            recipientUserId: userId,
            parentCompanyId: group.root.id,
            companyId: here.id,
            ownedCompanyId: other.id,
            reason,
            talkingPoints,
          },
        ],
        skipDuplicates: true,
      });
      if (res.count === 0) continue;
      created++;
      const flag = await prisma.meetingCrossRegionFlag.findFirstOrThrow({
        where: { meetingId, recipientUserId: userId, ownedCompanyId: other.id },
        select: { id: true },
      });
      await prisma.notification.create({
        data: {
          orgId,
          userId,
          type: 'system',
          title: `Cross-region signal: ${group.root.name}`,
          body: reason,
          entityType: 'meeting_intel_flag',
          entityId: flag.id,
          url: `/meeting-intel/flags/${flag.id}`,
        },
      });
    }
  }
  return created;
}

export const defaultPipelineDeps = (enqueue: PipelineDeps['enqueue']): PipelineDeps => ({
  adapters: defaultAdapters,
  enqueue,
  now: () => new Date(),
});

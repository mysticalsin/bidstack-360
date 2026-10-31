// Meeting intel: who met whom at which account (role, seniority, region/BU),
// challenges, similar projects, opportunities and next steps, pulled from ABC
// (org-level CRM) and Metis (per-user second brain, consent-scoped), plus
// manual entries. Coverage map, challenge rollup and cross-region flags help
// other regions of the same parent act on what was learned.
// Contract: fleet/polo-meeting-intel-api.md.
//
// Security model
//  * RBAC: meetings:read for every read, meetings:write for create/edit,
//    source connect/sync. The Metis push ingest is public at the auth layer
//    and authenticates with the user's own revocable connection token.
//  * Org + scope isolation: every query carries orgId; the meeting's company
//    must be in the caller's access scope. account_team meetings need team
//    membership too (meeting-intel/access.ts). Misses answer 404.
//  * Flags are redacted at read time: if the meeting's account is outside the
//    recipient's scope it shows as 'Restricted company', with no title or names.
//  * Consent: Metis items keep a transcript only with shareTranscript, and
//    meetings marked confidential are refused. Manual entries never carry one.
//  * Audit: every list, view and change writes audit_log (targetType meeting_intel).
import { createHash, randomBytes } from 'node:crypto';

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { Prisma, prisma } from '@bidstack/db';
import {
  applyMeetingConsent,
  ChallengeRollupResponse,
  classifySeniority,
  CoverageMapResponse,
  CrossRegionFlagOut,
  crossRegionTalkingPoints,
  emailDomain,
  MeetingIngestResult,
  MeetingIntelDetail,
  MeetingIntelListQuery,
  MeetingIntelListResponse,
  MeetingIntelManualCreate,
  MeetingIntelPatch,
  MeetingIntelWatchdogItem,
  meetingDedupeMaterial,
  MeetingSourceStatus,
  MetisConnectBody,
  MetisIngestBody,
  type MeetingIntelRow,
  type SeniorityLevel,
  SENIORITY_ORDER,
  seniorityRank,
} from '@bidstack/shared';

import { getAccessScope } from '../lib/access-scope.js';
import { userHasPermission } from '../lib/rbac-decision-cache.js';
import {
  companiesInScope,
  groupCompanyIds,
  isOnAccountTeam,
  RESTRICTED_COMPANY,
  scopedMeetingWhere,
  visibleMeetingWhere,
} from '../meeting-intel/access.js';
import { enqueueMeetingIntel } from '../queues/meeting-intel.js';

const DAY_MS = 86_400_000;
const TOKEN_PREFIX = 'pmi_';
const GAP_LEVELS: SeniorityLevel[] = ['c_level', 'vp', 'director'];
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const idParam = z.object({ id: z.string().uuid() });
const groupParam = z.object({ groupId: z.string().uuid() });

async function audit(
  req: FastifyRequest,
  action: string,
  targetId: string | null,
  diff: Record<string, unknown> = {},
  actor?: { orgId: string; userId: string },
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      orgId: actor?.orgId ?? req.auth.orgId,
      userId: actor?.userId ?? req.auth.userId,
      action,
      targetType: 'meeting_intel',
      targetId,
      diff: diff as Prisma.InputJsonValue,
    },
  });
}

const ROW_INCLUDE = {
  company: { select: { name: true } },
  sources: { select: { source: true, externalId: true, url: true, ingestedAt: true }, orderBy: { ingestedAt: 'asc' } },
  attendees: { select: { seniority: true, isInternal: true } },
} satisfies Prisma.MeetingIntelInclude;
type RowRecord = Prisma.MeetingIntelGetPayload<{ include: typeof ROW_INCLUDE }>;

function topSeniority(attendees: Array<{ seniority: SeniorityLevel; isInternal: boolean }>): SeniorityLevel {
  return attendees
    .filter((a) => !a.isInternal)
    .reduce<SeniorityLevel>((best, a) => (seniorityRank(a.seniority) < seniorityRank(best) ? a.seniority : best), 'unknown');
}

function toRow(r: RowRecord): MeetingIntelRow {
  return {
    id: r.id,
    companyId: r.companyId,
    companyName: r.company.name,
    title: r.title,
    heldAt: r.heldAt.toISOString(),
    visibility: r.visibility,
    sources: [...new Set(r.sources.map((s) => s.source))],
    attendeeCount: r.attendees.length,
    topSeniority: topSeniority(r.attendees),
    challenges: r.challenges,
    nextSteps: r.nextSteps,
  };
}

async function loadVisible(req: FastifyRequest, id: string) {
  const scope = await getAccessScope(req.auth.orgId, req.auth.userId);
  const row = await prisma.meetingIntel.findFirst({
    where: { AND: [{ id }, visibleMeetingWhere(req.auth.orgId, scope)] },
    include: {
      ...ROW_INCLUDE,
      attendees: {
        select: {
          id: true,
          name: true,
          email: true,
          title: true,
          seniority: true,
          region: true,
          businessUnit: true,
          isInternal: true,
          contactId: true,
          contact: { select: { reportsToContactId: true } },
        },
        orderBy: [{ isInternal: 'asc' }, { name: 'asc' }],
      },
    },
  });
  return { row, scope };
}

function connectionToken(): { token: string; hash: string; prefix: string } {
  const token = `${TOKEN_PREFIX}${randomBytes(24).toString('base64url')}`;
  return { token, hash: sha256(token), prefix: token.slice(0, 10) };
}

/** Same rules as the worker's storeIngestItems: consent first, unique per external id. */
async function storeItems(
  orgId: string,
  conn: { id: string; userId: string; source: 'metis' | 'abc'; shareSummary: boolean; shareTranscript: boolean },
  meetings: MetisIngestBody['meetings'],
) {
  const result: MeetingIngestResult = { accepted: 0, duplicates: 0, refused: [] };
  for (const m of meetings) {
    const consent = applyMeetingConsent(m, conn);
    if (!consent.ok) {
      result.refused.push({ externalId: m.externalId, reason: consent.reason });
      continue;
    }
    try {
      const item = await prisma.meetingIngestItem.create({
        data: {
          orgId,
          source: conn.source,
          externalId: m.externalId,
          connectionId: conn.id,
          submittedById: conn.userId,
          payload: consent.meeting as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      result.accepted++;
      await enqueueMeetingIntel({ kind: 'process', orgId, itemId: item.id });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        result.duplicates++;
        continue;
      }
      throw err;
    }
  }
  return result;
}

export const meetingIntelRoutes: FastifyPluginAsyncZod = async (server) => {
  // ─── list / detail ─────────────────────────────────────────────────────────
  server.get(
    '/meeting-intel',
    { config: { permission: 'meetings:read' }, schema: { querystring: MeetingIntelListQuery, response: { 200: MeetingIntelListResponse } } },
    async (req) => {
      const q = req.query;
      const orgId = req.auth.orgId;
      const scope = await getAccessScope(orgId, req.auth.userId);
      const and: Prisma.MeetingIntelWhereInput[] = [visibleMeetingWhere(orgId, scope)];
      if (q.companyId) and.push({ companyId: q.companyId });
      if (q.groupId) and.push({ companyId: { in: await groupCompanyIds(orgId, q.groupId) } });
      if (q.source) and.push({ sources: { some: { source: q.source } } });
      if (q.seniority) and.push({ attendees: { some: { seniority: q.seniority, isInternal: false } } });
      if (q.from) and.push({ heldAt: { gte: new Date(q.from) } });
      if (q.to) and.push({ heldAt: { lte: new Date(q.to) } });
      if (q.q) {
        and.push({
          OR: [
            { title: { contains: q.q, mode: 'insensitive' } },
            { summary: { contains: q.q, mode: 'insensitive' } },
            { challenges: { has: q.q } },
          ],
        });
      }
      const rows = await prisma.meetingIntel.findMany({
        where: { AND: and },
        include: ROW_INCLUDE,
        orderBy: [{ heldAt: 'desc' }, { id: 'desc' }],
        skip: q.cursor,
        take: q.limit + 1,
      });
      const more = rows.length > q.limit;
      const items = rows.slice(0, q.limit).map(toRow);
      await audit(req, 'meeting_intel.list', null, {
        filters: { companyId: q.companyId ?? null, groupId: q.groupId ?? null, source: q.source ?? null, q: q.q ?? null },
        returned: items.length,
      });
      return { items, nextCursor: more ? q.cursor + q.limit : null };
    },
  );

  server.get(
    '/meeting-intel/:id',
    { config: { permission: 'meetings:read' }, schema: { params: idParam, response: { 200: MeetingIntelDetail } } },
    async (req) => {
      const { row } = await loadVisible(req, req.params.id);
      if (!row) throw server.httpErrors.notFound('Meeting not found');
      await audit(req, 'meeting_intel.view', row.id, { transcript: row.transcriptText !== null });
      return {
        ...toRow(row),
        summary: row.summary,
        transcript: row.transcriptText,
        similarProjects: row.similarProjects,
        opportunities: row.opportunities,
        attendees: row.attendees.map(({ contact, ...a }) => ({ ...a, reportsToContactId: contact?.reportsToContactId ?? null })),
        sourceLinks: row.sources.map((s) => ({ source: s.source, externalId: s.externalId, url: s.url, ingestedAt: s.ingestedAt.toISOString() })),
        createdAt: row.createdAt.toISOString(),
      };
    },
  );

  // ─── manual entry / edit / archive ─────────────────────────────────────────
  server.post(
    '/meeting-intel',
    { config: { permission: 'meetings:write' }, schema: { body: MeetingIntelManualCreate, response: { 201: z.object({ id: z.string().uuid() }) } } },
    async (req, reply) => {
      const b = req.body;
      const orgId = req.auth.orgId;
      const scope = await getAccessScope(orgId, req.auth.userId);
      if (!(await companiesInScope(orgId, scope, [b.companyId])).has(b.companyId)) throw server.httpErrors.notFound('Account not found');
      const company = await prisma.company.findFirstOrThrow({ where: { id: b.companyId, orgId }, select: { countryCode: true } });
      const heldAt = new Date(b.heldAt);
      const users = await prisma.user.findMany({ where: { orgId, deletedAt: null }, select: { id: true, email: true }, take: 1000 });
      const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));
      const orgDomains = new Set(users.map((u) => emailDomain(u.email)).filter(Boolean));
      const emails = b.attendees.map((a) => a.email?.toLowerCase()).filter((e): e is string => !!e);
      const contacts = await prisma.contact.findMany({
        where: {
          orgId,
          deletedAt: null,
          OR: [...(emails.length ? [{ email: { in: emails } }] : []), { companyId: b.companyId, name: { in: b.attendees.map((a) => a.name) } }],
        },
        select: { id: true, email: true, name: true, role: true },
        take: 500,
      });
      const attendees = b.attendees.map((a) => {
        const email = a.email?.toLowerCase() ?? null;
        const userId = email ? (userByEmail.get(email) ?? null) : null;
        const contact = userId ? null : (contacts.find((c) => (email && c.email?.toLowerCase() === email) || c.name === a.name) ?? null);
        const isInternal = !!userId || (!!email && orgDomains.has(emailDomain(email)));
        return {
          orgId,
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
      const dedupeKey = sha256(
        meetingDedupeMaterial({ orgId, companyId: b.companyId, heldAt, title: b.title, attendeeEmails: [] }).byTitle,
      );
      const dup = await prisma.meetingIntel.findFirst({ where: { orgId, dedupeKey, deletedAt: null }, select: { id: true } });
      if (dup) throw server.httpErrors.conflict('This meeting is already recorded');
      const id = (
        await prisma.meetingIntel.create({
          data: {
            orgId,
            companyId: b.companyId,
            title: b.title,
            heldAt,
            visibility: b.visibility ?? 'account_team',
            summary: b.summary ?? null,
            challenges: b.challenges,
            similarProjects: b.similarProjects,
            opportunities: b.opportunities,
            nextSteps: b.nextSteps,
            dedupeKey,
            createdById: req.auth.userId,
            sources: {
              create: [{ orgId, source: 'manual', externalId: `manual:${dedupeKey.slice(0, 32)}`, url: b.url ?? null, connectionUserId: req.auth.userId }],
            },
            attendees: { create: attendees },
          },
          select: { id: true },
        })
      ).id;
      await enqueueMeetingIntel({ kind: 'flags', orgId, meetingId: id });
      await audit(req, 'meeting_intel.create', id, { companyId: b.companyId, attendees: attendees.length, visibility: b.visibility ?? 'account_team' });
      return reply.code(201).send({ id });
    },
  );

  async function loadEditable(req: FastifyRequest, id: string) {
    const { row } = await loadVisible(req, id);
    if (!row) throw server.httpErrors.notFound('Meeting not found');
    const can = row.createdById === req.auth.userId || (await isOnAccountTeam(req.auth.orgId, req.auth.userId, row.companyId));
    if (!can) throw server.httpErrors.forbidden('Only the account team or the author can change this meeting');
    return row;
  }

  server.patch(
    '/meeting-intel/:id',
    { config: { permission: 'meetings:write' }, schema: { params: idParam, body: MeetingIntelPatch, response: { 200: z.object({ id: z.string().uuid() }) } } },
    async (req) => {
      const row = await loadEditable(req, req.params.id);
      await prisma.meetingIntel.update({ where: { id: row.id }, data: req.body });
      await audit(req, 'meeting_intel.update', row.id, { changed: Object.keys(req.body), visibility: req.body.visibility ?? null });
      return { id: row.id };
    },
  );

  server.delete(
    '/meeting-intel/:id',
    { config: { permission: 'meetings:write' }, schema: { params: idParam } },
    async (req, reply) => {
      const row = await loadEditable(req, req.params.id);
      await prisma.$transaction([
        prisma.meetingIntel.update({ where: { id: row.id }, data: { deletedAt: new Date() } }),
        prisma.meetingCrossRegionFlag.updateMany({ where: { meetingId: row.id, status: 'open' }, data: { status: 'dismissed', dismissedAt: new Date() } }),
      ]);
      await audit(req, 'meeting_intel.archive', row.id, { title: row.title });
      return reply.code(204).send();
    },
  );

  // ─── account group rollups ─────────────────────────────────────────────────
  async function loadGroup(req: FastifyRequest, groupId: string) {
    const orgId = req.auth.orgId;
    const scope = await getAccessScope(orgId, req.auth.userId);
    const ids = await groupCompanyIds(orgId, groupId);
    const inScope = await companiesInScope(orgId, scope, ids);
    if (!inScope.has(groupId)) throw server.httpErrors.notFound('Account not found');
    return { orgId, scope, inScope: [...inScope] };
  }

  server.get(
    '/meeting-intel/accounts/:groupId/coverage',
    {
      config: { permission: 'meetings:read' },
      schema: {
        params: groupParam,
        querystring: z.object({ windowDays: z.coerce.number().int().min(7).max(1095).default(365) }),
        response: { 200: CoverageMapResponse },
      },
    },
    async (req) => {
      const { orgId, scope, inScope } = await loadGroup(req, req.params.groupId);
      const since = new Date(Date.now() - req.query.windowDays * DAY_MS);
      // Counts only (no names): every in-scope meeting counts, whatever its visibility.
      const meetings = await prisma.meetingIntel.findMany({
        where: { AND: [scopedMeetingWhere(orgId, scope), { companyId: { in: inScope }, heldAt: { gte: since } }] },
        select: {
          id: true,
          heldAt: true,
          company: { select: { countryCode: true } },
          attendees: { where: { isInternal: false }, select: { seniority: true, region: true, contactId: true, email: true, name: true } },
        },
        take: 1000,
      });
      const companies = await prisma.company.findMany({ where: { orgId, id: { in: inScope } }, select: { countryCode: true }, take: inScope.length });
      const cells = new Map<string, { region: string; seniority: SeniorityLevel; meetings: Set<string>; people: Set<string>; last: Date }>();
      const regions = new Set(companies.map((c) => c.countryCode?.toUpperCase()).filter((r): r is string => !!r));
      for (const m of meetings) {
        for (const a of m.attendees) {
          const region = (a.region ?? m.company.countryCode ?? 'Unknown').toUpperCase();
          regions.add(region);
          const key = `${region}|${a.seniority}`;
          const cell = cells.get(key) ?? { region, seniority: a.seniority, meetings: new Set(), people: new Set(), last: m.heldAt };
          cell.meetings.add(m.id);
          cell.people.add(a.contactId ?? a.email ?? a.name.toLowerCase());
          if (m.heldAt > cell.last) cell.last = m.heldAt;
          cells.set(key, cell);
        }
      }
      const regionList = [...regions].sort();
      const gaps = regionList.flatMap((region) => GAP_LEVELS.filter((s) => !cells.has(`${region}|${s}`)).map((seniority) => ({ region, seniority })));
      await audit(req, 'meeting_intel.coverage.view', req.params.groupId, { windowDays: req.query.windowDays });
      return {
        groupId: req.params.groupId,
        regions: regionList,
        seniorities: [...SENIORITY_ORDER],
        cells: [...cells.values()]
          .sort((a, b) => a.region.localeCompare(b.region) || seniorityRank(a.seniority) - seniorityRank(b.seniority))
          .map((c) => ({ region: c.region, seniority: c.seniority, meetings: c.meetings.size, people: c.people.size, lastMetAt: c.last.toISOString() })),
        gaps,
        windowDays: req.query.windowDays,
      };
    },
  );

  server.get(
    '/meeting-intel/accounts/:groupId/challenges',
    {
      config: { permission: 'meetings:read' },
      schema: {
        params: groupParam,
        querystring: z.object({ windowDays: z.coerce.number().int().min(7).max(1095).default(365), limit: z.coerce.number().int().min(1).max(100).default(25) }),
        response: { 200: ChallengeRollupResponse },
      },
    },
    async (req) => {
      const { orgId, scope, inScope } = await loadGroup(req, req.params.groupId);
      const since = new Date(Date.now() - req.query.windowDays * DAY_MS);
      // Challenges come only from meetings the caller can open.
      const meetings = await prisma.meetingIntel.findMany({
        where: { AND: [visibleMeetingWhere(orgId, scope), { companyId: { in: inScope }, heldAt: { gte: since } }] },
        select: { id: true, heldAt: true, challenges: true, company: { select: { countryCode: true } } },
        orderBy: { heldAt: 'desc' },
        take: 1000,
      });
      const agg = new Map<string, { challenge: string; mentions: number; regions: Set<string>; last: Date; ids: string[] }>();
      for (const m of meetings) {
        for (const ch of new Set(m.challenges)) {
          const key = ch.trim().toLowerCase();
          if (!key) continue;
          const e = agg.get(key) ?? { challenge: ch.trim(), mentions: 0, regions: new Set<string>(), last: m.heldAt, ids: [] };
          e.mentions++;
          if (m.company.countryCode) e.regions.add(m.company.countryCode.toUpperCase());
          if (m.heldAt > e.last) e.last = m.heldAt;
          if (e.ids.length < 20) e.ids.push(m.id);
          agg.set(key, e);
        }
      }
      const items = [...agg.values()]
        .sort((a, b) => b.mentions - a.mentions || b.last.getTime() - a.last.getTime())
        .slice(0, req.query.limit)
        .map((e) => ({ challenge: e.challenge, mentions: e.mentions, regions: [...e.regions].sort(), lastMentionedAt: e.last.toISOString(), meetingIds: e.ids }));
      await audit(req, 'meeting_intel.challenges.view', req.params.groupId, { returned: items.length });
      return { groupId: req.params.groupId, items };
    },
  );

  // ─── cross-region flags (notifications + watchdog feed) ────────────────────
  server.get(
    '/meeting-intel/flags',
    {
      config: { permission: 'meetings:read' },
      schema: {
        querystring: z.object({
          status: z.enum(['open', 'dismissed', 'all']).default('open'),
          format: z.enum(['flags', 'watchdog']).default('flags'),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
        response: { 200: z.object({ items: z.array(CrossRegionFlagOut) }).or(z.object({ items: z.array(MeetingIntelWatchdogItem) })) },
      },
    },
    async (req) => {
      const orgId = req.auth.orgId;
      const scope = await getAccessScope(orgId, req.auth.userId);
      const flags = await prisma.meetingCrossRegionFlag.findMany({
        where: {
          orgId,
          recipientUserId: req.auth.userId,
          ...(req.query.status === 'all' ? {} : { status: req.query.status }),
          meeting: { deletedAt: null },
        },
        include: {
          meeting: {
            select: { title: true, heldAt: true, challenges: true, opportunities: true, attendees: { select: { seniority: true, isInternal: true, region: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: req.query.limit,
      });
      const companyIds = [...new Set(flags.flatMap((f) => [f.companyId, f.parentCompanyId, f.ownedCompanyId]))];
      const visible = await companiesInScope(orgId, scope, companyIds);
      const names = new Map(
        (await prisma.company.findMany({ where: { orgId, id: { in: companyIds } }, select: { id: true, name: true, countryCode: true }, take: companyIds.length })).map(
          (c) => [c.id, c],
        ),
      );
      const out: CrossRegionFlagOut[] = flags.map((f) => {
        const restricted = !visible.has(f.companyId);
        const parent = names.get(f.parentCompanyId);
        const owned = names.get(f.ownedCompanyId);
        const here = names.get(f.companyId);
        const parentName = parent?.name ?? RESTRICTED_COMPANY;
        const ownedName = owned?.name ?? RESTRICTED_COMPANY;
        const meetingRegion = here?.countryCode ?? 'another region';
        const talkingPoints = crossRegionTalkingPoints({
          parentName,
          meetingRegion: restricted ? 'another region' : meetingRegion,
          ownedRegion: owned?.countryCode ?? ownedName,
          topSeniority: topSeniority(f.meeting.attendees),
          challenges: f.meeting.challenges,
          opportunities: f.meeting.opportunities,
          restricted,
        });
        return {
          id: f.id,
          meetingId: f.meetingId,
          parentCompanyId: f.parentCompanyId,
          parentCompanyName: parentName,
          companyName: restricted ? RESTRICTED_COMPANY : (here?.name ?? RESTRICTED_COMPANY),
          companyRestricted: restricted,
          ownedCompanyId: f.ownedCompanyId,
          ownedCompanyName: ownedName,
          reason: restricted
            ? `You cover ${ownedName}. A colleague met ${parentName} in another region.`
            : `You cover ${ownedName}. ${f.meeting.title} took place at ${here?.name} (${meetingRegion}).`,
          talkingPoints,
          status: f.status as 'open' | 'dismissed',
          createdAt: f.createdAt.toISOString(),
        };
      });
      await audit(req, 'meeting_intel.flags.list', null, { returned: out.length, format: req.query.format });
      if (req.query.format === 'watchdog') {
        return {
          items: out.map((f) => ({
            kind: 'MEETING_CROSS_REGION' as const,
            externalId: f.id,
            companyId: f.ownedCompanyId,
            occurredAt: f.createdAt,
            title: `Cross-region signal: ${f.parentCompanyName}`,
            summary: [f.reason, ...f.talkingPoints].join(' '),
            implication: 'OPPORTUNITY' as const,
            url: `/meeting-intel/flags/${f.id}`,
          })),
        };
      }
      return { items: out };
    },
  );

  server.post(
    '/meeting-intel/flags/:id/dismiss',
    { config: { permission: 'meetings:read' }, schema: { params: idParam } },
    async (req, reply) => {
      const res = await prisma.meetingCrossRegionFlag.updateMany({
        where: { id: req.params.id, orgId: req.auth.orgId, recipientUserId: req.auth.userId },
        data: { status: 'dismissed', dismissedAt: new Date() },
      });
      if (res.count === 0) throw server.httpErrors.notFound('Flag not found');
      await audit(req, 'meeting_intel.flag.dismiss', req.params.id);
      return reply.code(204).send();
    },
  );

  // ─── sources ───────────────────────────────────────────────────────────────
  server.get(
    '/meeting-intel/sources',
    { config: { permission: 'meetings:read' }, schema: { response: { 200: z.object({ items: z.array(MeetingSourceStatus) }) } } },
    async (req) => {
      const orgId = req.auth.orgId;
      const [abc, metis] = await Promise.all([
        prisma.meetingSourceConnection.findFirst({ where: { orgId, source: 'abc' }, orderBy: { createdAt: 'asc' } }),
        prisma.meetingSourceConnection.findFirst({ where: { orgId, source: 'metis', userId: req.auth.userId } }),
      ]);
      const counts = async (connectionId: string | undefined) => {
        if (!connectionId) return { pending: 0, unmatched: 0 };
        const [pending, unmatched] = await Promise.all([
          prisma.meetingIngestItem.count({ where: { orgId, connectionId, status: 'pending' } }),
          prisma.meetingIngestItem.count({ where: { orgId, connectionId, status: 'unmatched' } }),
        ]);
        return { pending, unmatched };
      };
      const shape = async (source: 'abc' | 'metis', scope: 'org' | 'user', c: typeof abc) => ({
        source,
        scope,
        status: !c
          ? ('not_connected' as const)
          : c.status === 'connected' && c.lastError === 'not_configured'
            ? ('not_configured' as const)
            : c.status === 'connected' && c.lastError
              ? ('error' as const)
              : (c.status as 'connected' | 'revoked' | 'error'),
        shareSummary: c?.shareSummary ?? null,
        shareTranscript: c?.shareTranscript ?? null,
        tokenPrefix: scope === 'user' ? (c?.tokenPrefix ?? null) : null,
        lastSyncAt: c?.lastSyncAt?.toISOString() ?? null,
        lastError: c?.lastError ?? null,
        itemsReceived: c?.itemsReceived ?? 0,
        ...(await counts(c?.id)),
      });
      return { items: [await shape('abc', 'org', abc), await shape('metis', 'user', metis)] };
    },
  );

  server.post(
    '/meeting-intel/sources/metis/connect',
    {
      config: { permission: 'meetings:write' },
      schema: { body: MetisConnectBody, response: { 200: z.object({ token: z.string(), tokenPrefix: z.string(), shareSummary: z.boolean(), shareTranscript: z.boolean() }) } },
    },
    async (req) => {
      const { orgId, userId } = req.auth;
      const t = connectionToken();
      const data = {
        status: 'connected',
        shareSummary: true,
        shareTranscript: req.body.shareTranscript,
        tokenHash: t.hash,
        tokenPrefix: t.prefix,
        consentedAt: new Date(),
        revokedAt: null,
        lastError: null,
      };
      const conn = await prisma.meetingSourceConnection.upsert({
        where: { orgId_userId_source: { orgId, userId, source: 'metis' } },
        create: { orgId, userId, source: 'metis', ...data },
        update: data,
      });
      await audit(req, 'meeting_intel.source.connect', conn.id, { source: 'metis', shareTranscript: req.body.shareTranscript });
      // The token is shown once; only its hash is stored.
      return { token: t.token, tokenPrefix: t.prefix, shareSummary: true, shareTranscript: req.body.shareTranscript };
    },
  );

  server.delete(
    '/meeting-intel/sources/metis',
    { config: { permission: 'meetings:read' } },
    async (req, reply) => {
      const { orgId, userId } = req.auth;
      const res = await prisma.meetingSourceConnection.updateMany({
        where: { orgId, userId, source: 'metis', status: { not: 'revoked' } },
        data: { status: 'revoked', revokedAt: new Date(), tokenHash: null, shareTranscript: false },
      });
      if (res.count === 0) throw server.httpErrors.notFound('No Metis connection');
      await audit(req, 'meeting_intel.source.revoke', null, { source: 'metis' });
      return reply.code(204).send();
    },
  );

  server.post(
    '/meeting-intel/sources/abc/sync',
    { config: { permission: 'meetings:write' }, schema: { response: { 202: z.object({ connectionId: z.string().uuid(), queued: z.boolean() }) } } },
    async (req, reply) => {
      const { orgId, userId } = req.auth;
      const existing = await prisma.meetingSourceConnection.findFirst({ where: { orgId, source: 'abc' }, orderBy: { createdAt: 'asc' } });
      const conn =
        existing ??
        (await prisma.meetingSourceConnection.create({ data: { orgId, userId, source: 'abc', consentedAt: new Date() } }));
      if (conn.status !== 'connected') throw server.httpErrors.conflict('ABC source is not connected');
      const queued = (await enqueueMeetingIntel({ kind: 'sync', orgId, connectionId: conn.id })) !== null;
      await audit(req, 'meeting_intel.source.sync', conn.id, { source: 'abc', queued });
      return reply.code(202).send({ connectionId: conn.id, queued });
    },
  );

  // ─── Metis push ingest (per-user token, consent-scoped) ────────────────────
  server.post(
    '/meeting-intel/ingest/metis',
    {
      config: { public: true, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { body: MetisIngestBody, response: { 200: MeetingIngestResult } },
    },
    async (req) => {
      const header = req.headers.authorization ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
      if (!token.startsWith(TOKEN_PREFIX) || token.length > 200) throw server.httpErrors.unauthorized('Invalid token');
      const conn = await prisma.meetingSourceConnection.findFirst({ where: { tokenHash: sha256(token), source: 'metis', status: 'connected' } });
      if (!conn) throw server.httpErrors.unauthorized('Invalid token');
      const user = await prisma.user.findFirst({ where: { id: conn.userId, orgId: conn.orgId, deletedAt: null }, select: { id: true } });
      if (!user || !(await userHasPermission(conn.orgId, conn.userId, 'meetings:write'))) throw server.httpErrors.forbidden('Not allowed');
      const result = await storeItems(conn.orgId, { ...conn, source: 'metis' }, req.body.meetings);
      await prisma.meetingSourceConnection.update({
        where: { id: conn.id },
        data: { lastSyncAt: new Date(), lastError: null, itemsReceived: { increment: result.accepted } },
      });
      await audit(req, 'meeting_intel.ingest', conn.id, { source: 'metis', ...result, refused: result.refused.length }, { orgId: conn.orgId, userId: conn.userId });
      return result;
    },
  );
};

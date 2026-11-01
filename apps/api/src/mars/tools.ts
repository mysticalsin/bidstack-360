// Read-only tool surface over meeting intel and the org chart, in MCP
// `tools/list` + `tools/call` shape: list_meetings, list_contacts,
// suggest_org_chart. Agents (Metis included) call it with the user's own
// Polo session, so every rule of the REST API applies unchanged:
//   * account must be in the caller's access scope (else not_found, never forbidden);
//   * meetings follow visibleMeetingWhere, Admin sees team-only meetings in
//     scope (admin_override, audited like the list endpoint);
//   * email and LinkedIn only with contacts:read;
//   * suggest_org_chart also needs orgchart:read and never writes: an admin
//     applies a suggestion with the normal org chart move or seed endpoints.
// Design: fleet/polo-mars-integration.md.
import { createHash } from 'node:crypto';

import { Prisma, prisma } from '@bidstack/db';
import {
  type ChartPersonRef,
  dedupePeople,
  inferReportingLines,
  MARS_TOOLS,
  type MarsContactOut,
  MarsToolInputs,
  type MarsToolName,
  meetingRecency,
  NormalizedMeeting,
  normalizeLinkedinHandle,
  type OrgChartSuggestion,
  type PersonSighting,
} from '@bidstack/shared';

import { type AccessScope, getAccessScope } from '../lib/access-scope.js';
import { userHasAnyRole, userHasPermission } from '../lib/rbac-decision-cache.js';
import { accountInScope } from '../org-chart/access.js';
import { scopedMeetingWhere, visibleMeetingWhere } from '../meeting-intel/access.js';

export class MarsToolError extends Error {
  constructor(readonly code: 'not_found' | 'forbidden' | 'invalid_input', message: string) {
    super(message);
    this.name = 'MarsToolError';
  }
}

export interface ToolCaller {
  orgId: string;
  userId: string;
}

export const listMarsTools = () => MARS_TOOLS;

const DAY = 86_400_000;
/** Stable, opaque person id: the same person gets the same key in every tool, and no email or handle leaks through it. */
const opaque = (orgId: string, key: string) => `p_${createHash('sha256').update(`${orgId}|${key}`).digest('hex').slice(0, 20)}`;

async function readable(caller: ToolCaller, scope: AccessScope) {
  const admin = await userHasAnyRole(caller.orgId, caller.userId, ['Admin']);
  return { admin, where: admin ? scopedMeetingWhere(caller.orgId, scope) : visibleMeetingWhere(caller.orgId, scope) };
}

async function audit(caller: ToolCaller, tool: MarsToolName, companyId: string, diff: Record<string, unknown>) {
  await prisma.auditLog.create({
    data: {
      orgId: caller.orgId,
      userId: caller.userId,
      action: `meeting_intel.tool.${tool}`,
      targetType: 'company',
      targetId: companyId,
      diff: { via: 'tool', ...diff } as Prisma.InputJsonValue,
    },
  });
}

async function account(caller: ToolCaller, accountId: string) {
  const scope = await getAccessScope(caller.orgId, caller.userId);
  const company = await accountInScope(caller.orgId, scope, accountId);
  if (!company) throw new MarsToolError('not_found', 'Account not found');
  return { scope, company };
}

/** Visible meetings of one account in a window, with attendee rows and MARS hints from the ingest payload. */
async function meetingsWithPeople(caller: ToolCaller, scope: AccessScope, companyId: string, since: Date) {
  const base = await readable(caller, scope);
  const meetings = await prisma.meetingIntel.findMany({
    where: { AND: [base.where, { companyId }, { heldAt: { gte: since } }] },
    select: {
      id: true,
      heldAt: true,
      attendees: { where: { isInternal: false }, select: { name: true, email: true, title: true, region: true, businessUnit: true, contactId: true } },
    },
    orderBy: { heldAt: 'desc' },
    take: 1000,
  });
  const items = meetings.length
    ? await prisma.meetingIngestItem.findMany({
        where: { orgId: caller.orgId, source: 'mars', status: 'processed', meetingIntelId: { in: meetings.map((m) => m.id) } },
        select: { meetingIntelId: true, payload: true },
        take: 5000,
      })
    : [];
  const hints = new Map<string, { linkedinUrl?: string; reportsTo?: { name: string; email?: string } }>();
  for (const it of items) {
    const p = NormalizedMeeting.safeParse(it.payload);
    if (!p.success) continue;
    for (const a of p.data.attendees) {
      if (!a.linkedinUrl && !a.reportsTo) continue;
      hints.set(`${it.meetingIntelId}|${a.email?.toLowerCase() ?? `n:${a.name.toLowerCase()}`}`, { ...(a.linkedinUrl ? { linkedinUrl: a.linkedinUrl } : {}), ...(a.reportsTo ? { reportsTo: a.reportsTo } : {}) });
    }
  }
  const contactIdByKey = new Map<string, string>();
  const sightings: PersonSighting[] = [];
  for (const m of meetings) {
    for (const a of m.attendees) {
      const h = hints.get(`${m.id}|${a.email?.toLowerCase() ?? `n:${a.name.toLowerCase()}`}`);
      sightings.push({
        name: a.name,
        email: a.email,
        linkedinUrl: h?.linkedinUrl ?? null,
        companyId,
        title: a.title,
        department: a.businessUnit,
        country: a.region,
        seenAt: m.heldAt.toISOString(),
        meetingRef: m.id,
        reportsTo: h?.reportsTo ? { name: h.reportsTo.name, email: h.reportsTo.email ?? null } : null,
      });
      if (a.contactId && a.email) contactIdByKey.set(a.email.toLowerCase(), a.contactId);
    }
  }
  return { admin: base.admin, meetings, people: dedupePeople(sightings), contactIdByKey };
}

export async function callMarsTool(caller: ToolCaller, name: string, rawArgs: unknown, now: Date = new Date()): Promise<unknown> {
  if (!(['list_meetings', 'list_contacts', 'suggest_org_chart'] as const).includes(name as MarsToolName)) {
    throw new MarsToolError('invalid_input', `Unknown tool ${name.slice(0, 40)}`);
  }
  const tool = name as MarsToolName;
  const parsed = MarsToolInputs[tool].safeParse(rawArgs ?? {});
  if (!parsed.success) throw new MarsToolError('invalid_input', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ').slice(0, 500));

  if (tool === 'list_meetings') {
    const args = MarsToolInputs.list_meetings.parse(rawArgs ?? {});
    const { scope, company } = await account(caller, args.accountId);
    const base = await readable(caller, scope);
    const rows = await prisma.meetingIntel.findMany({
      where: {
        AND: [
          base.where,
          { companyId: company.id },
          ...(args.since ? [{ heldAt: { gte: new Date(args.since) } }] : []),
          ...(args.source ? [{ sources: { some: { source: args.source } } }] : []),
        ],
      },
      select: {
        id: true,
        title: true,
        heldAt: true,
        visibility: true,
        challenges: true,
        nextSteps: true,
        sources: { select: { source: true } },
        attendees: { select: { name: true, title: true, seniority: true, region: true, isInternal: true } },
      },
      orderBy: [{ heldAt: 'desc' }, { id: 'desc' }],
      take: args.limit,
    });
    await audit(caller, tool, company.id, { returned: rows.length, source: args.source ?? null, ...(base.admin ? { admin: true } : {}) });
    return {
      account: { id: company.id, name: company.name },
      meetings: rows.map((r) => ({
        id: r.id,
        title: r.title,
        heldAt: r.heldAt.toISOString(),
        visibility: r.visibility,
        sources: [...new Set(r.sources.map((s) => s.source))],
        clientAttendees: r.attendees.filter((a) => !a.isInternal).map(({ isInternal: _i, ...a }) => a),
        ourAttendees: r.attendees.filter((a) => a.isInternal).map((a) => a.name),
        challenges: r.challenges,
        nextSteps: r.nextSteps,
      })),
    };
  }

  if (tool === 'list_contacts') {
    const args = MarsToolInputs.list_contacts.parse(rawArgs ?? {});
    const { scope, company } = await account(caller, args.accountId);
    const canSeePii = await userHasPermission(caller.orgId, caller.userId, 'contacts:read');
    const { people, contactIdByKey, admin } = await meetingsWithPeople(caller, scope, company.id, new Date(now.getTime() - args.windowDays * DAY));
    const contacts: MarsContactOut[] = people.slice(0, args.limit).map((p) => ({
      key: opaque(caller.orgId, p.key),
      name: p.name,
      title: p.title,
      seniority: p.seniority,
      department: p.department,
      country: p.country,
      email: canSeePii ? (p.emails[0] ?? null) : null,
      linkedinUrl: canSeePii && p.linkedinHandle ? `https://www.linkedin.com/in/${encodeURIComponent(p.linkedinHandle)}` : null,
      contactId: p.emails.map((e) => contactIdByKey.get(e)).find(Boolean) ?? null,
      meetingCount: p.meetingCount,
      firstMetAt: p.firstMetAt,
      lastMetAt: p.lastMetAt,
      recency: meetingRecency(p.lastMetAt, now),
    }));
    await audit(caller, tool, company.id, { returned: contacts.length, pii: canSeePii, ...(admin ? { admin: true } : {}) });
    return { account: { id: company.id, name: company.name }, contacts, total: people.length };
  }

  const args = MarsToolInputs.suggest_org_chart.parse(rawArgs ?? {});
  if (!(await userHasPermission(caller.orgId, caller.userId, 'orgchart:read'))) throw new MarsToolError('forbidden', 'Not allowed');
  const { scope, company } = await account(caller, args.accountId);
  const { people, admin } = await meetingsWithPeople(caller, scope, company.id, new Date(now.getTime() - args.windowDays * DAY));
  const chart = await prisma.orgChart.findFirst({ where: { orgId: caller.orgId, companyId: company.id }, select: { id: true, version: true } });
  const nodes = chart
    ? await prisma.orgChartNode.findMany({
        where: { orgId: caller.orgId, chartId: chart.id, deletedAt: null },
        select: { id: true, parentId: true, name: true, email: true, linkedinUrl: true, externalRef: true, contact: { select: { email: true } } },
        take: 1000,
      })
    : [];
  const refs: ChartPersonRef[] = nodes.map((n) => ({
    nodeId: n.id,
    parentId: n.parentId,
    name: n.name,
    linkedinHandle: normalizeLinkedinHandle(n.linkedinUrl),
    emails: [...new Set([n.email, n.contact?.email, n.externalRef?.includes('@') ? n.externalRef : null].filter((e): e is string => !!e).map((e) => e.toLowerCase()))],
  }));
  const suggestions: OrgChartSuggestion[] = inferReportingLines({ people, chart: refs, minConfidence: args.minConfidence });
  await audit(caller, tool, company.id, { returned: suggestions.length, people: people.length, ...(admin ? { admin: true } : {}) });
  return {
    account: { id: company.id, name: company.name },
    chartVersion: chart?.version ?? null,
    peopleConsidered: people.length,
    suggestions: suggestions.map((x) => ({ ...x, personKey: opaque(caller.orgId, x.personKey), managerKey: opaque(caller.orgId, x.managerKey) })),
    howToApply: 'Suggestions are not applied. An admin moves a node with POST /org-chart/nodes/:id/move, or adds missing people with POST /companies/:id/org-chart/seed.',
  };
}

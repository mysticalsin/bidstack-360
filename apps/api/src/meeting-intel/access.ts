// Meeting intel visibility and account-group helpers (API side).
//
// A meeting is readable when ALL of these hold:
//   1. same org, not deleted;
//   2. its company is inside the caller's access scope (applyCompanyScope);
//   3. visibility = 'org', OR the caller is on the account team: key account
//      owner, director sponsor, owner of an open opportunity on the company,
//      the person who logged or shared the meeting, or an internal attendee.
// Anything else answers 404, like a missing row.
import { Prisma, prisma } from '@bidstack/db';

import { applyCompanyScope, type AccessScope } from '../lib/access-scope.js';

export const OPEN_STAGES = ['s1_lead', 's1_ongoing', 's2_sent', 's3_technical_iteration', 's4_negotiation'] as const;
export const RESTRICTED_COMPANY = 'Restricted company';
const MAX_GROUP = 500;

export function accountTeamPredicate(userId: string): Prisma.CompanyWhereInput {
  return {
    OR: [
      { keyAccountOwnerId: userId },
      { directorSponsorId: userId },
      { opportunities: { some: { ownerId: userId, deletedAt: null, stage: { in: [...OPEN_STAGES] } } } },
    ],
  };
}

export function visibleMeetingWhere(orgId: string, scope: AccessScope): Prisma.MeetingIntelWhereInput {
  const me = scope.userId;
  return {
    orgId,
    deletedAt: null,
    company: applyCompanyScope({ orgId, deletedAt: null }, scope),
    OR: [
      { visibility: 'org' },
      { createdById: me },
      { attendees: { some: { userId: me } } },
      { company: accountTeamPredicate(me) },
    ],
  };
}

/** Meetings on in-scope companies regardless of visibility (aggregates only). */
export function scopedMeetingWhere(orgId: string, scope: AccessScope): Prisma.MeetingIntelWhereInput {
  return { orgId, deletedAt: null, company: applyCompanyScope({ orgId, deletedAt: null }, scope) };
}

export async function isOnAccountTeam(orgId: string, userId: string, companyId: string): Promise<boolean> {
  const n = await prisma.company.count({ where: { id: companyId, orgId, ...accountTeamPredicate(userId) } });
  return n > 0;
}

/** The company plus all its descendants (bounded BFS). */
export async function groupCompanyIds(orgId: string, rootId: string): Promise<string[]> {
  const ids = [rootId];
  let frontier = [rootId];
  while (frontier.length && ids.length < MAX_GROUP) {
    const kids = await prisma.company.findMany({
      where: { orgId, deletedAt: null, parentId: { in: frontier } },
      select: { id: true },
      take: MAX_GROUP - ids.length,
    });
    frontier = kids.map((k) => k.id).filter((id) => !ids.includes(id));
    ids.push(...frontier);
  }
  return ids;
}

export async function companiesInScope(orgId: string, scope: AccessScope, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await prisma.company.findMany({
    where: applyCompanyScope({ orgId, id: { in: ids }, deletedAt: null }, scope),
    select: { id: true },
    take: ids.length,
  });
  return new Set(rows.map((r) => r.id));
}

// Which stored consulting partner evidence a caller may see.
//
// Public rows (news, firm sites, newsroom, fixtures) follow the account: any
// caller who can open the account and holds account-intel:read sees them.
// Internal rows quote our own records, so each one is shown only when the
// caller can already read that record today:
//   meeting            meetings:read and visibleMeetingWhere (org visibility,
//                      creator, attendee or account team)
//   note, activity     activities:read; opportunity-linked ones also need the
//                      opportunity in scope
//   email              the mailbox owner, or activities:read for mail filed to
//                      a deal (opportunity in scope) or contact; unfiled mail
//                      is never scanned
//   win_loss, bid_intel, competitor_insight, opportunity
//                      opportunities:read and the opportunity in scope
// API keys see public rows only. Deleted records drop out even before the
// next rescan removes their rows.
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { isInternalPartnerRow, prisma, type PartnerEvidenceRow } from '@bidstack/db';

import { applyOpportunityScope, getAccessScope, isApiKeyActor } from '../lib/access-scope.js';
import { visibleMeetingWhere } from '../meeting-intel/access.js';

const OPP_RECORDS = new Set(['win_loss', 'bid_intel', 'competitor_insight', 'opportunity']);

const uniq = (xs: Array<string | null | undefined>) => [...new Set(xs.filter((x): x is string => Boolean(x)))];

/** The rows the caller may see, in input order. */
export async function visiblePartnerRows(server: FastifyInstance, req: FastifyRequest, rows: PartnerEvidenceRow[]): Promise<PartnerEvidenceRow[]> {
  const internal = rows.filter(isInternalPartnerRow);
  if (internal.length === 0) return rows;
  const { orgId, userId } = req.auth;
  if (req.auth.role === 'api' || isApiKeyActor(userId)) return rows.filter((r) => !isInternalPartnerRow(r));

  const [scope, canMeetings, canActivities, canOpps] = await Promise.all([
    getAccessScope(orgId, userId),
    server.hasPermission(req, 'meetings:read'),
    server.hasPermission(req, 'activities:read'),
    server.hasPermission(req, 'opportunities:read'),
  ]);
  const ids = (type: string) => uniq(internal.filter((r) => r.recordType === type).map((r) => r.recordId));
  const oppIds = uniq(internal.map((r) => r.opportunityId));

  const [opps, meetings, notes, activities, emails] = await Promise.all([
    oppIds.length
      ? prisma.opportunity.findMany({ where: applyOpportunityScope({ orgId, id: { in: oppIds }, deletedAt: null }, scope), select: { id: true }, take: oppIds.length })
      : [],
    canMeetings && ids('meeting').length
      ? prisma.meetingIntel.findMany({ where: { AND: [visibleMeetingWhere(orgId, scope), { id: { in: ids('meeting') } }] }, select: { id: true }, take: ids('meeting').length })
      : [],
    canActivities && ids('note').length ? prisma.note.findMany({ where: { orgId, id: { in: ids('note') }, deletedAt: null }, select: { id: true }, take: ids('note').length }) : [],
    canActivities && ids('activity').length
      ? prisma.activity.findMany({ where: { orgId, id: { in: ids('activity') }, deletedAt: null }, select: { id: true }, take: ids('activity').length })
      : [],
    ids('email').length
      ? prisma.emailMessage.findMany({ where: { orgId, id: { in: ids('email') }, deletedAt: null }, select: { id: true, userId: true, entityType: true }, take: ids('email').length })
      : [],
  ]);
  const oppOk = new Set(opps.map((o) => o.id));
  const meetingOk = new Set(meetings.map((m) => m.id));
  const noteOk = new Set(notes.map((n) => n.id));
  const activityOk = new Set(activities.map((a) => a.id));
  const emailById = new Map(emails.map((e) => [e.id, e]));

  const linkedOk = (r: PartnerEvidenceRow) => !r.opportunityId || oppOk.has(r.opportunityId);
  const allowed = (r: PartnerEvidenceRow): boolean => {
    if (!isInternalPartnerRow(r)) return true;
    const id = r.recordId ?? '';
    switch (r.recordType) {
      case 'meeting':
        return meetingOk.has(id);
      case 'note':
        return noteOk.has(id) && linkedOk(r);
      case 'activity':
        return activityOk.has(id) && linkedOk(r);
      case 'email': {
        const e = emailById.get(id);
        if (!e) return false;
        if (e.userId === userId) return true;
        if (!canActivities) return false;
        if (e.entityType === 'deal') return Boolean(r.opportunityId) && oppOk.has(r.opportunityId!);
        return e.entityType === 'contact';
      }
      default:
        return OPP_RECORDS.has(r.recordType ?? '') && canOpps && Boolean(r.opportunityId) && oppOk.has(r.opportunityId!);
    }
  };
  return rows.filter(allowed);
}

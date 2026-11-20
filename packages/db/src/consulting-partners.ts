/**
 * Consulting partners persistence (slice 15): scan our own records for firm
 * mentions, store evidence drafts, and read rows back for the API, the MCP
 * and Jarvis tool and the seed.
 *
 * Internal scan sources, all for one account: notes, meeting intel (summary
 * and lists, never transcripts), activities on the company or its deals,
 * emails filed to its deals or contacts (unfiled mail is never read), win/loss
 * records, competitor insights on its deals and bid competitor fields. Reads
 * return record ids only; callers apply access rules before showing them.
 */
import {
  DEFAULT_CONSULTING_FIRMS,
  firmCatalog,
  firmKeyFor,
  INTERNAL_PARTNER_SOURCES,
  PARTNER_SOURCE_LABEL,
  parseFirmList,
  PartnerDomain,
  PartnerEvidenceSource,
  PartnerRemark,
  readBidCompetitor,
  readInternalRecord,
  readWinLoss,
  type ConsultingFirm,
  type PartnerEvidence,
  type PartnerEvidenceDraft,
  type PartnerRunStatus,
} from '@bidstack/shared';

import type { Prisma, PrismaClient } from '../generated/client/index.js';

const DAY = 86_400_000;
/** Internal records older than this are not scanned. */
export const PARTNER_SCAN_YEARS = 3;
/** Evidence older than this (by fetch time) is pruned. */
export const PARTNER_RETENTION_DAYS = 3 * 365;
const TAKE = 500;

type Db = PrismaClient;

/** The firm catalog for one org: defaults, the deployment list and the org's competitor profiles. */
export async function loadOrgFirmCatalog(db: Pick<Db, 'competitorProfile'>, orgId: string, extraList?: string | null): Promise<ConsultingFirm[]> {
  const profiles = await db.competitorProfile.findMany({
    where: { orgId, deletedAt: null },
    select: { name: true, aliases: true, domain: true },
    take: 200,
  });
  const known = new Map<string, string>();
  for (const f of DEFAULT_CONSULTING_FIRMS) for (const a of f.aliases) known.set(a.toLowerCase(), f.key);
  const fromProfiles: ConsultingFirm[] = profiles.map((p) => ({
    key: known.get(p.name.toLowerCase()) ?? firmKeyFor(p.name),
    name: p.name,
    aliases: [p.name, ...p.aliases].filter((a) => a.trim().length >= 2),
    domains: p.domain ? [p.domain.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')] : [],
  }));
  return firmCatalog(parseFirmList(extraList), fromProfiles);
}

interface BidIntelCompetitor {
  vendor?: unknown;
  score?: unknown;
  strengths?: unknown;
  weaknesses?: unknown;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string').slice(0, 20) : []);

/** Firm mentions in our own records for one account. Pure read; nothing is written. */
export async function scanInternalPartnerEvidence(
  db: Db,
  args: { orgId: string; companyId: string; firms: readonly ConsultingFirm[]; now?: Date },
): Promise<PartnerEvidenceDraft[]> {
  const { orgId, companyId, firms } = args;
  const since = new Date((args.now ?? new Date()).getTime() - PARTNER_SCAN_YEARS * 365 * DAY);
  const opps = await db.opportunity.findMany({
    where: { orgId, companyId, deletedAt: null },
    select: { id: true, name: true, intel: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
    take: TAKE,
  });
  const oppIds = opps.map((o) => o.id);
  const contacts = await db.contact.findMany({ where: { orgId, companyId, deletedAt: null }, select: { id: true }, take: 2000 });
  const contactIds = contacts.map((c) => c.id);

  const [notes, meetings, activities, emails, winLoss, insights] = await Promise.all([
    db.note.findMany({
      where: { orgId, companyId, deletedAt: null, updatedAt: { gte: since } },
      select: { id: true, title: true, bodyMd: true, createdAt: true },
      take: TAKE,
    }),
    db.meetingIntel.findMany({
      where: { orgId, companyId, deletedAt: null, heldAt: { gte: since } },
      select: { id: true, title: true, summary: true, challenges: true, opportunities: true, nextSteps: true, heldAt: true },
      take: TAKE,
    }),
    db.activity.findMany({
      where: {
        orgId,
        deletedAt: null,
        occurredAt: { gte: since },
        OR: [{ entityType: 'company', entityId: companyId }, ...(oppIds.length ? [{ entityType: 'opportunity', entityId: { in: oppIds } }] : [])],
      },
      select: { id: true, subject: true, description: true, entityType: true, entityId: true, occurredAt: true },
      take: TAKE * 2,
    }),
    oppIds.length || contactIds.length
      ? db.emailMessage.findMany({
          where: {
            orgId,
            deletedAt: null,
            OR: [
              ...(oppIds.length ? [{ entityType: 'deal', entityId: { in: oppIds } }] : []),
              ...(contactIds.length ? [{ entityType: 'contact', entityId: { in: contactIds } }] : []),
            ],
          },
          select: { id: true, subject: true, bodyText: true, sentAt: true, receivedAt: true, entityType: true, entityId: true },
          orderBy: { createdAt: 'desc' },
          take: TAKE,
        })
      : Promise.resolve([]),
    oppIds.length
      ? db.winLossRecord.findMany({
          where: { orgId, opportunityId: { in: oppIds } },
          select: { id: true, opportunityId: true, outcome: true, reason: true, competitor: true, note: true, createdAt: true, opportunity: { select: { name: true, closedAt: true } } },
          take: TAKE,
        })
      : Promise.resolve([]),
    oppIds.length
      ? db.competitorInsight.findMany({
          where: { orgId, deletedAt: null, status: 'active', opportunityId: { in: oppIds } },
          select: { id: true, opportunityId: true, title: true, summary: true, publishedAt: true, retrievedAt: true, competitorProfile: { select: { name: true } } },
          take: TAKE,
        })
      : Promise.resolve([]),
  ]);

  const drafts: PartnerEvidenceDraft[] = [];
  for (const n of notes) {
    drafts.push(...readInternalRecord({ source: 'note', recordType: 'note', recordId: n.id, title: n.title, text: n.bodyMd, occurredAt: n.createdAt }, firms));
  }
  for (const m of meetings) {
    const text = [m.summary ?? '', ...m.challenges, ...m.opportunities, ...m.nextSteps].join('\n');
    drafts.push(...readInternalRecord({ source: 'meeting', recordType: 'meeting', recordId: m.id, title: m.title, text, occurredAt: m.heldAt }, firms));
  }
  for (const a of activities) {
    drafts.push(
      ...readInternalRecord(
        { source: 'activity', recordType: 'activity', recordId: a.id, opportunityId: a.entityType === 'opportunity' ? a.entityId : null, title: a.subject, text: a.description ?? '', occurredAt: a.occurredAt },
        firms,
      ),
    );
  }
  for (const e of emails) {
    drafts.push(
      ...readInternalRecord(
        { source: 'email', recordType: 'email', recordId: e.id, opportunityId: e.entityType === 'deal' ? e.entityId : null, title: e.subject, text: e.bodyText ?? '', occurredAt: e.sentAt ?? e.receivedAt },
        firms,
      ),
    );
  }
  for (const w of winLoss) {
    drafts.push(
      ...readWinLoss(
        { id: w.id, opportunityId: w.opportunityId, opportunityName: w.opportunity.name, outcome: w.outcome, reason: w.reason, competitor: w.competitor, note: w.note, decidedAt: w.opportunity.closedAt ?? w.createdAt },
        firms,
      ),
    );
  }
  for (const i of insights) {
    drafts.push(
      ...readInternalRecord(
        { source: 'competitor_insight', recordType: 'competitor_insight', recordId: i.id, opportunityId: i.opportunityId, title: `${i.competitorProfile.name}: ${i.title}`, text: i.summary, occurredAt: i.publishedAt ?? i.retrievedAt },
        firms,
      ),
    );
  }
  for (const o of opps) {
    const comps = (o.intel as { competitors?: BidIntelCompetitor[] } | null)?.competitors;
    if (!Array.isArray(comps)) continue;
    for (const c of comps.slice(0, 20)) {
      if (typeof c?.vendor !== 'string') continue;
      drafts.push(
        ...readBidCompetitor(
          { opportunityId: o.id, opportunityName: o.name, vendor: c.vendor, score: typeof c.score === 'number' ? c.score : null, strengths: strings(c.strengths), weaknesses: strings(c.weaknesses), at: o.updatedAt },
          firms,
        ),
      );
    }
  }
  return drafts;
}

function rowData(d: PartnerEvidenceDraft, fetchedAt: Date) {
  return {
    firmName: d.firmName.slice(0, 120),
    origin: d.origin,
    source: d.source,
    method: d.method,
    inferred: d.inferred,
    url: d.url,
    recordType: d.recordType,
    recordId: d.recordId,
    opportunityId: d.opportunityId,
    title: d.title,
    excerpt: d.excerpt,
    occurredAt: d.occurredAt,
    fetchedAt,
    relationship: d.relationship,
    domains: d.domains,
    context: d.context,
    sentiment: d.sentiment,
    remarks: d.remarks as unknown as Prisma.InputJsonValue,
    outcome: d.outcome,
    sample: d.sample,
  };
}

/** Counts written by one save. */
export interface PartnerSaveResult {
  new: number;
  updated: number;
  removed: number;
}

/**
 * Upsert drafts for one account. With `replaceInternal`, internal rows not in
 * `drafts` are removed (the record was deleted or no longer names the firm).
 */
export async function savePartnerEvidence(
  db: Pick<Db, 'consultingPartnerEvidence'>,
  args: { orgId: string; companyId: string; drafts: PartnerEvidenceDraft[]; now: Date; replaceInternal?: boolean },
): Promise<PartnerSaveResult> {
  const { orgId, companyId, now } = args;
  const unique = new Map<string, PartnerEvidenceDraft>();
  for (const d of args.drafts) unique.set(`${d.firmKey}|${d.key}`, d);
  const existing = await db.consultingPartnerEvidence.findMany({ where: { orgId, companyId }, select: { id: true, firmKey: true, key: true, origin: true }, take: 5000 });
  const have = new Set(existing.map((e) => `${e.firmKey}|${e.key}`));
  let removed = 0;
  if (args.replaceInternal) {
    const stale = existing.filter((e) => e.origin === 'internal' && !unique.has(`${e.firmKey}|${e.key}`)).map((e) => e.id);
    if (stale.length) removed = (await db.consultingPartnerEvidence.deleteMany({ where: { orgId, id: { in: stale } } })).count;
  }
  let created = 0;
  let updated = 0;
  for (const [k, d] of unique) {
    const data = rowData(d, now);
    await db.consultingPartnerEvidence.upsert({
      where: { orgId_companyId_firmKey_key: { orgId, companyId, firmKey: d.firmKey, key: d.key } },
      create: { orgId, companyId, firmKey: d.firmKey, key: d.key, ...data },
      update: data,
    });
    if (have.has(k)) updated++;
    else created++;
  }
  return { new: created, updated, removed };
}

/** Retention: drop evidence fetched more than three years ago. */
export async function prunePartnerEvidence(db: Pick<Db, 'consultingPartnerEvidence'>, orgId: string, now: Date = new Date()): Promise<number> {
  const cut = new Date(now.getTime() - PARTNER_RETENTION_DAYS * DAY);
  return (await db.consultingPartnerEvidence.deleteMany({ where: { orgId, fetchedAt: { lt: cut } } })).count;
}

/** Stored evidence row as read back. */
export type PartnerEvidenceRow = Awaited<ReturnType<PrismaClient['consultingPartnerEvidence']['findFirstOrThrow']>>;

function hrefFor(row: PartnerEvidenceRow): string | null {
  if (row.origin !== 'internal' || !row.recordId) return null;
  switch (row.recordType) {
    case 'meeting':
      return `/meetings/${row.recordId}`;
    case 'note':
      return `/companies/${row.companyId}`;
    case 'opportunity':
    case 'win_loss':
    case 'competitor_insight':
      return row.opportunityId ? `/opportunities/${row.opportunityId}` : null;
    case 'activity':
    case 'email':
      return row.opportunityId ? `/opportunities/${row.opportunityId}` : `/accounts/${row.companyId}`;
    default:
      return null;
  }
}

const REMARK_LIST = PartnerRemark.array();

/** Wire shape for one stored row. Unknown enum values from older rows are dropped, not thrown. */
export function toPartnerEvidence(row: PartnerEvidenceRow): PartnerEvidence {
  const source = PartnerEvidenceSource.safeParse(row.source);
  const remarks = REMARK_LIST.safeParse(row.remarks);
  const src = source.success ? source.data : 'fixture';
  return {
    id: row.id,
    firmKey: row.firmKey,
    firmName: row.firmName,
    origin: row.origin === 'internal' ? 'internal' : 'public',
    source: src,
    sourceLabel: PARTNER_SOURCE_LABEL[src],
    method: (['keyword_match', 'record_field', 'llm_extract', 'fixture'] as const).find((m) => m === row.method) ?? 'keyword_match',
    inferred: row.inferred,
    url: row.origin === 'public' ? row.url : null,
    recordType: row.recordType,
    recordId: row.recordId,
    recordHref: hrefFor(row),
    title: row.title,
    excerpt: row.excerpt,
    date: row.occurredAt?.toISOString() ?? null,
    fetchedAt: row.fetchedAt.toISOString(),
    relationship: (['strategic_partner', 'implementation', 'managed_services', 'audit', 'advisory', 'engineering'] as const).find((r) => r === row.relationship) ?? null,
    domains: row.domains.filter((d): d is PartnerDomain => PartnerDomain.safeParse(d).success),
    context: (['incumbent', 'competing', 'client_feedback', 'mention'] as const).find((c) => c === row.context) ?? null,
    sentiment: (['positive', 'neutral', 'negative'] as const).find((s) => s === row.sentiment) ?? null,
    remarks: remarks.success ? remarks.data : [],
    outcome: row.outcome === 'won' || row.outcome === 'lost' ? row.outcome : null,
    sample: row.sample,
  };
}

/** True for evidence read from our own records. */
export function isInternalPartnerRow(row: Pick<PartnerEvidenceRow, 'origin' | 'source'>): boolean {
  return row.origin === 'internal' || INTERNAL_PARTNER_SOURCES.includes(row.source as PartnerEvidence['source']);
}

/** Every stored row for one account, newest first (bounded). */
export async function loadPartnerEvidenceRows(db: Pick<Db, 'consultingPartnerEvidence'>, orgId: string, companyId: string, take = 1000): Promise<PartnerEvidenceRow[]> {
  return db.consultingPartnerEvidence.findMany({
    where: { orgId, companyId },
    orderBy: [{ occurredAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
    take,
  });
}

/** Won and open opportunities on the account, within `scope` when given. */
export async function countPartnerEngagements(
  db: Pick<Db, 'opportunity'>,
  orgId: string,
  companyId: string,
  scope?: Prisma.OpportunityWhereInput | null,
): Promise<{ won: number; open: number }> {
  const base: Prisma.OpportunityWhereInput = { orgId, companyId, deletedAt: null, ...(scope ? { AND: [scope] } : {}) };
  const [won, open] = await Promise.all([
    db.opportunity.count({ where: { ...base, stage: 'closed_won' } }),
    db.opportunity.count({ where: { ...base, stage: { notIn: ['closed_won', 'closed_lost'] } } }),
  ]);
  return { won, open };
}

/**
 * Internal rows whose record `userId` personally authored, owns or attended.
 * A strict subset of what any access rule grants, used where the full
 * request scope is not available (Jarvis tool runs).
 */
export async function ownedPartnerRowIds(db: Db, orgId: string, userId: string, rows: PartnerEvidenceRow[]): Promise<Set<string>> {
  const ids = (type: string) => [...new Set(rows.filter((r) => r.recordType === type && r.recordId).map((r) => r.recordId!))];
  const oppIds = [...new Set(rows.filter((r) => r.opportunityId && ['opportunity', 'competitor_insight'].includes(r.recordType ?? '')).map((r) => r.opportunityId!))];
  const [notes, meetings, activities, emails, winLoss, opps] = await Promise.all([
    db.note.findMany({ where: { orgId, id: { in: ids('note') }, deletedAt: null, authorUserId: userId }, select: { id: true }, take: ids('note').length }),
    db.meetingIntel.findMany({ where: { orgId, id: { in: ids('meeting') }, deletedAt: null, OR: [{ createdById: userId }, { attendees: { some: { userId } } }] }, select: { id: true }, take: ids('meeting').length }),
    db.activity.findMany({ where: { orgId, id: { in: ids('activity') }, deletedAt: null, OR: [{ ownerId: userId }, { actorId: userId }] }, select: { id: true }, take: ids('activity').length }),
    db.emailMessage.findMany({ where: { orgId, id: { in: ids('email') }, deletedAt: null, userId }, select: { id: true }, take: ids('email').length }),
    db.winLossRecord.findMany({ where: { orgId, id: { in: ids('win_loss') }, recordedById: userId }, select: { id: true }, take: ids('win_loss').length }),
    db.opportunity.findMany({ where: { orgId, id: { in: oppIds }, deletedAt: null, ownerId: userId }, select: { id: true }, take: oppIds.length }),
  ]);
  const owned = new Set([...notes, ...meetings, ...activities, ...emails, ...winLoss].map((r) => r.id));
  const ownedOpps = new Set(opps.map((o) => o.id));
  return new Set(
    rows
      .filter((r) => (r.recordId && owned.has(r.recordId)) || (r.opportunityId && ['opportunity', 'competitor_insight'].includes(r.recordType ?? '') && ownedOpps.has(r.opportunityId)))
      .map((r) => r.id),
  );
}

/** Last scan for one account. */
export async function loadPartnerRun(db: Pick<Db, 'consultingPartnerRun'>, orgId: string, companyId: string): Promise<PartnerRunStatus> {
  const run = await db.consultingPartnerRun.findUnique({ where: { orgId_companyId: { orgId, companyId } } });
  const r = (run?.result ?? {}) as Partial<PartnerRunStatus['result']>;
  const status = (['queued', 'running', 'ok', 'partial', 'failed', 'not_configured'] as const).find((s) => s === run?.status) ?? 'never';
  return {
    status,
    lastFetchedAt: run?.lastFetchedAt?.toISOString() ?? null,
    result: { new: r.new ?? 0, updated: r.updated ?? 0, skipped: r.skipped ?? 0, failed: r.failed ?? 0 },
    detail: run?.detail ?? null,
  };
}

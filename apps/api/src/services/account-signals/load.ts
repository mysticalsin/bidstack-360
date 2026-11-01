// Read model for account signals (v21): loads the dated rows the shared
// momentum, timeline and initiatives rules need, batched for many accounts.
// Contract: /workspace/fleet/polo-signals-api.md
import { prisma } from '@bidstack/db';
import {
  categoryForKind,
  computeMomentum,
  sentimentForRow,
  type Implication,
  type MomentumData,
  type MomentumOpp,
  type MomentumResult,
} from '@bidstack/shared';

import type { AccessScope } from '../../lib/access-scope.js';
import { companiesWithLiveSignals, hideSampleWhere, newsIdentifiers } from './live-signals.js';
import { scopedMeetingWhere } from '../../meeting-intel/access.js';

const DAY = 86_400_000;

export interface OppRow {
  id: string;
  companyId: string | null;
  name: string;
  stage: string;
  valueMicros: bigint;
  createdAt: Date;
  updatedAt: Date;
  closedAt?: Date | null;
  pipelineStage?: { isWon: boolean; isLost: boolean; deletedAt?: Date | null } | null;
}

/**
 * Lost wins when the enum or a live stage says lost. A soft-deleted stage
 * does not close the deal.
 */
export function recordedOutcome(o: {
  stage: string;
  pipelineStage?: { isWon: boolean; isLost: boolean; deletedAt?: Date | null } | null;
}): 'won' | 'lost' | 'open' {
  const live = o.pipelineStage?.deletedAt ? null : o.pipelineStage;
  if (o.stage === 'closed_lost' || live?.isLost) return 'lost';
  if (o.stage === 'closed_won' || live?.isWon) return 'won';
  return 'open';
}

/** When a deal closed: closedAt, or the last update for deals closed before closedAt existed. */
export function closedAtOf(o: OppRow): Date | null {
  if (recordedOutcome(o) === 'open') return null;
  return o.closedAt ?? o.updatedAt;
}

export function toMomentumOpp(o: OppRow): MomentumOpp {
  return {
    createdAt: o.createdAt,
    closedAt: closedAtOf(o),
    outcome: recordedOutcome(o),
    valueMicros: o.valueMicros,
  };
}

export const OPP_SELECT = {
  id: true,
  companyId: true,
  name: true,
  stage: true,
  valueMicros: true,
  createdAt: true,
  updatedAt: true,
  closedAt: true,
  pipelineStage: { select: { isWon: true, isLost: true, deletedAt: true } },
} as const;

/** Root account plus its direct children (one level: subsidiaries roll up). */
export async function groupMap(orgId: string, rootIds: string[]): Promise<Map<string, string[]>> {
  const kids = rootIds.length
    ? await prisma.company.findMany({ where: { orgId, parentId: { in: rootIds }, deletedAt: null }, select: { id: true, parentId: true }, take: 1000 })
    : [];
  const map = new Map<string, string[]>(rootIds.map((id) => [id, [id]]));
  for (const k of kids) if (k.parentId) map.get(k.parentId)?.push(k.id);
  return map;
}

export interface LoadedSignals {
  data: MomentumData;
  sample: boolean;
  openPipelineMicros: bigint;
}

/** Query guard: every findMany needs take <= 1000, so accounts load in small chunks. */
const CHUNK = 6;
const TAKE = 1000;

/** Momentum inputs for many accounts (each with its children), in chunks of 6. */
export async function loadMomentumInputs(orgId: string, scope: AccessScope, rootIds: string[], now: Date): Promise<Map<string, LoadedSignals>> {
  const out = new Map<string, LoadedSignals>();
  for (let i = 0; i < rootIds.length; i += CHUNK) {
    const part = await loadChunk(orgId, scope, rootIds.slice(i, i + CHUNK), now);
    for (const [k, v] of part) out.set(k, v);
  }
  return out;
}

async function loadChunk(orgId: string, scope: AccessScope, rootIds: string[], now: Date): Promise<Map<string, LoadedSignals>> {
  const groups = await groupMap(orgId, rootIds);
  const owner = new Map<string, string>();
  for (const [root, ids] of groups) for (const id of ids) owner.set(id, root);
  const all = [...owner.keys()];
  const live = await companiesWithLiveSignals(orgId, all);
  const since = new Date(now.getTime() - 400 * DAY);
  const [opps, meetings, postings, events, firmo] = await Promise.all([
    prisma.opportunity.findMany({ where: { orgId, companyId: { in: all }, deletedAt: null }, select: OPP_SELECT, orderBy: { updatedAt: 'desc' }, take: TAKE }),
    prisma.meetingIntel.findMany({
      where: { AND: [scopedMeetingWhere(orgId, scope), { companyId: { in: all }, heldAt: { gte: since, lte: now } }] },
      select: { companyId: true, heldAt: true },
      orderBy: { heldAt: 'desc' },
      take: TAKE,
    }),
    prisma.companyJobPosting.findMany({
      where: { orgId, companyId: { in: all }, postedAt: { gte: new Date(now.getTime() - 160 * DAY) } },
      select: { companyId: true, postedAt: true },
      orderBy: { postedAt: 'desc' },
      take: TAKE,
    }),
    prisma.accountWatchEvent.findMany({
      where: { orgId, companyId: { in: all }, status: { not: 'DISMISSED' }, occurredAt: { gte: since, lte: now }, ...hideSampleWhere(live) },
      select: { companyId: true, occurredAt: true, importance: true, severity: true, sentiment: true, implication: true, kind: true, sample: true },
      orderBy: { occurredAt: 'desc' },
      take: TAKE,
    }),
    prisma.companyFirmographics.findMany({ where: { orgId, companyId: { in: rootIds } }, select: { companyId: true, headcountGrowth12m: true }, take: CHUNK }),
  ]);
  const out = new Map<string, LoadedSignals>();
  for (const id of rootIds) {
    out.set(id, { data: { opps: [], meetings: [], postings: [], events: [], headcountGrowth12m: null }, sample: false, openPipelineMicros: 0n });
  }
  const at = (companyId: string | null) => (companyId ? out.get(owner.get(companyId) ?? '') : undefined);
  for (const o of opps) {
    const t = at(o.companyId);
    if (!t) continue;
    t.data.opps.push(toMomentumOpp(o));
    if (o.stage !== 'closed_won' && o.stage !== 'closed_lost') t.openPipelineMicros += o.valueMicros;
  }
  for (const m of meetings) at(m.companyId)?.data.meetings.push(m.heldAt);
  for (const p of postings) if (p.postedAt) at(p.companyId)?.data.postings.push(p.postedAt);
  for (const e of events) {
    const t = at(e.companyId);
    if (!t) continue;
    t.data.events.push({
      occurredAt: e.occurredAt,
      importance: e.importance || e.severity * 20,
      sentiment: sentimentForRow({ sentiment: e.sentiment, implication: e.implication as Implication, kind: e.kind }),
      category: categoryForKind(e.kind, e.implication as Implication),
    });
    if (e.sample) t.sample = true;
  }
  for (const f of firmo) {
    const t = out.get(f.companyId);
    if (t) t.data.headcountGrowth12m = f.headcountGrowth12m ?? null;
  }
  return out;
}

export function momentumFor(loaded: LoadedSignals | undefined, now: Date): MomentumResult {
  return computeMomentum(loaded?.data ?? { opps: [], meetings: [], postings: [], events: [], headcountGrowth12m: null }, now);
}

/** Watchdog sources and whether each one is feeding this account now. */
export async function sourceStatus(orgId: string, companyId: string, env: Record<string, string | undefined> = process.env) {
  const [subject, firmo, meetings, company, finProfile] = await Promise.all([
    prisma.accountWatchSubject.findFirst({ where: { orgId, companyId }, select: { enabled: true, secCik: true, companiesHouseNumber: true, irFeedUrl: true, identifiersConfirmedAt: true, ticker: true } }),
    prisma.companyFirmographics.findFirst({ where: { orgId, companyId }, select: { status: true, fetchedAt: true } }),
    prisma.meetingIntel.count({ where: { orgId, companyId, deletedAt: null } }),
    prisma.company.findFirst({ where: { orgId, id: companyId }, select: { domain: true } }),
    prisma.accountFinancialProfile.findFirst({ where: { orgId, companyId }, select: { status: true } }),
  ]);
  const ids = newsIdentifiers(company?.domain, subject);
  const news = (env.WATCHDOG_NEWS_SOURCES ?? '').split(',').map((s) => s.trim());
  const confirmed = Boolean(subject?.enabled && subject.identifiersConfirmedAt);
  return [
    { id: 'crm', label: 'Deals and bids', active: true },
    { id: 'meetings', label: 'Meeting intel', active: meetings > 0 },
    { id: 'enrichment', label: 'Hiring and firmographics', active: Boolean(firmo?.fetchedAt) },
    { id: 'news', label: 'News (GDELT, Google News)', active: (news.includes('gdelt') || news.includes('google_news')) && !ids.hint, hint: ids.hint },
    { id: 'press', label: 'Company press feed', active: news.includes('company_rss') && Boolean(subject?.irFeedUrl) },
    { id: 'filings', label: 'Public filings', active: confirmed && Boolean(subject?.secCik || subject?.companiesHouseNumber) },
    { id: 'financials', label: 'Financial statements (EDGAR, ESEF)', active: finProfile?.status === 'ok' },
    { id: 'linkedin', label: 'LinkedIn updates (provider)', active: env.WATCHDOG_APIFY_LINKEDIN_ENABLED === 'true' && Boolean(env.APIFY_TOKEN) },
  ];
}

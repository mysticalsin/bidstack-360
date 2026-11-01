// Read model for account signals (v21): loads the dated rows the shared
// momentum, timeline and initiatives rules need, batched for many accounts.
// Contract: /workspace/fleet/polo-signals-api.md
import { prisma } from '@bidstack/db';
import {
  categoryForKind,
  computeMomentum,
  pulsePageNotes,
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

/** Micros that belong in the open portfolio total. A live lost or won stage adds nothing. */
export function openBookMicros(o: OppRow): bigint {
  return recordedOutcome(o) === 'open' ? o.valueMicros : 0n;
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

/** A full page is a sample only when one more row exists. `take` stays at the guard limit. */
export function pageIsCapped(rowCount: number, total: number, limit = TAKE): boolean {
  return rowCount >= limit && total > limit;
}

/** Root account plus its direct children. A parent with more than 1000 children is named. */
export async function groupRollup(orgId: string, rootIds: string[]): Promise<{ groups: Map<string, string[]>; cappedRoots: Set<string> }> {
  const groups = new Map<string, string[]>();
  const cappedRoots = new Set<string>();
  await Promise.all(rootIds.map(async (root) => {
    const where = { orgId, parentId: root, deletedAt: null };
    const kids = await prisma.company.findMany({ where, select: { id: true }, orderBy: { id: 'asc' }, take: TAKE });
    const capped = kids.length === TAKE && pageIsCapped(kids.length, await prisma.company.count({ where }), TAKE);
    groups.set(root, [root, ...kids.map((kid) => kid.id)]);
    if (capped) cappedRoots.add(root);
  }));
  return { groups, cappedRoots };
}

/** Root account plus its direct children (one level: subsidiaries roll up). */
export async function groupMap(orgId: string, rootIds: string[]): Promise<Map<string, string[]>> {
  return (await groupRollup(orgId, rootIds)).groups;
}

export interface LoadedSignals {
  data: MomentumData;
  sample: boolean;
  openPipelineMicros: bigint;
  /** True when this account has more deals than the momentum page. */
  dealsCapped: boolean;
  /** True when meetings, postings, or watch events filled the momentum page. */
  feedsCapped: boolean;
  meetingsCapped: boolean;
  postingsCapped: boolean;
  newsCapped: boolean;
  /** True when this account has more direct subsidiaries than the rollup page. */
  childrenCapped: boolean;
}

/** Query guard: every findMany needs take <= 1000, so accounts load in small chunks. */
const CHUNK = 6;
const TAKE = 1000;

/** Keep the latest page and say when one more row proved it is not the book. */
export function capMomentumDeals<T>(rows: readonly T[], limit = TAKE): { rows: T[]; capped: boolean } {
  if (rows.length <= limit) return { rows: [...rows], capped: false };
  return { rows: rows.slice(0, limit), capped: true };
}

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
  const { groups, cappedRoots } = await groupRollup(orgId, rootIds);
  const owner = new Map<string, string>();
  for (const [root, ids] of groups) for (const id of ids) owner.set(id, root);
  const all = [...owner.keys()];
  const live = await companiesWithLiveSignals(orgId, all);
  const since = new Date(now.getTime() - 400 * DAY);
  const postedSince = new Date(now.getTime() - 160 * DAY);
  const readPage = async <T,>(load: () => Promise<T[]>, count: () => Promise<number>) => {
    const rows = await load();
    if (rows.length < TAKE) return { rows, capped: false };
    return { rows, capped: pageIsCapped(rows.length, await count(), TAKE) };
  };
  const pages = <T,>(load: (ids: string[]) => Promise<{ rows: T[]; capped: boolean }>) =>
    Promise.all(rootIds.map(async (root) => {
      const loaded = await load(groups.get(root) ?? [root]);
      return { root, ...loaded };
    }));
  const [oppGroups, meetingGroups, postingGroups, eventGroups, firmo] = await Promise.all([
    pages((ids) => {
      const where = { orgId, companyId: { in: ids }, deletedAt: null };
      return readPage(
        () => prisma.opportunity.findMany({ where, select: OPP_SELECT, orderBy: { updatedAt: 'desc' }, take: TAKE }),
        () => prisma.opportunity.count({ where }),
      );
    }),
    pages((ids) => {
      const where = { AND: [scopedMeetingWhere(orgId, scope), { companyId: { in: ids }, heldAt: { gte: since, lte: now } }] };
      return readPage(
        () => prisma.meetingIntel.findMany({ where, select: { heldAt: true }, orderBy: { heldAt: 'desc' }, take: TAKE }),
        () => prisma.meetingIntel.count({ where }),
      );
    }),
    pages((ids) => {
      const where = { orgId, companyId: { in: ids }, postedAt: { gte: postedSince } };
      return readPage(
        () => prisma.companyJobPosting.findMany({ where, select: { postedAt: true }, orderBy: { postedAt: 'desc' }, take: TAKE }),
        () => prisma.companyJobPosting.count({ where }),
      );
    }),
    pages((ids) => {
      const where = { orgId, companyId: { in: ids }, status: { not: 'DISMISSED' as const }, occurredAt: { gte: since, lte: now }, ...hideSampleWhere(live) };
      return readPage(
        () => prisma.accountWatchEvent.findMany({
          where,
          select: { occurredAt: true, importance: true, severity: true, sentiment: true, implication: true, kind: true, sample: true },
          orderBy: { occurredAt: 'desc' },
          take: TAKE,
        }),
        () => prisma.accountWatchEvent.count({ where }),
      );
    }),
    prisma.companyFirmographics.findMany({ where: { orgId, companyId: { in: rootIds } }, select: { companyId: true, headcountGrowth12m: true }, take: CHUNK }),
  ]);
  const out = new Map<string, LoadedSignals>();
  for (const id of rootIds) {
    out.set(id, { data: { opps: [], meetings: [], postings: [], events: [], headcountGrowth12m: null }, sample: false, openPipelineMicros: 0n, dealsCapped: false, feedsCapped: false, meetingsCapped: false, postingsCapped: false, newsCapped: false, childrenCapped: cappedRoots.has(id) });
  }
  for (const group of oppGroups) {
    const t = out.get(group.root);
    if (!t) continue;
    t.dealsCapped = group.capped;
    for (const o of group.rows) {
      t.data.opps.push(toMomentumOpp(o));
      t.openPipelineMicros += openBookMicros(o);
    }
  }
  for (const group of meetingGroups) {
    const t = out.get(group.root);
    if (!t) continue;
    if (group.capped) {
      t.feedsCapped = true;
      t.meetingsCapped = true;
    }
    for (const m of group.rows) t.data.meetings.push(m.heldAt);
  }
  for (const group of postingGroups) {
    const t = out.get(group.root);
    if (!t) continue;
    if (group.capped) {
      t.feedsCapped = true;
      t.postingsCapped = true;
    }
    for (const p of group.rows) if (p.postedAt) t.data.postings.push(p.postedAt);
  }
  for (const group of eventGroups) {
    const t = out.get(group.root);
    if (!t) continue;
    if (group.capped) {
      t.feedsCapped = true;
      t.newsCapped = true;
    }
    for (const e of group.rows) {
      t.data.events.push({
        occurredAt: e.occurredAt,
        importance: e.importance || e.severity * 20,
        sentiment: sentimentForRow({ sentiment: e.sentiment, implication: e.implication as Implication, kind: e.kind }),
        category: categoryForKind(e.kind, e.implication as Implication),
      });
      if (e.sample) t.sample = true;
    }
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

/** Job-post counts are the page. Headcount is the 12-month figure, not that page. */
export function hiringPageDetail(detail: string): string {
  const marker = ', headcount';
  const at = detail.indexOf(marker);
  if (at === -1) {
    if (!detail.toLowerCase().includes('roles posted')) return detail;
    return `${detail} Latest 1,000 job posts.`;
  }
  const roles = detail.slice(0, at);
  const headcount = detail.slice(at + 2);
  return `${roles}, from the latest 1,000 job posts. ${headcount.charAt(0).toUpperCase()}${headcount.slice(1)}`;
}

/** A capped page is not the whole book. Say so on the lines that used that page. */
export function annotatePulseRead<T extends { key: string; detail: string }>(
  drivers: readonly T[],
  caps: { dealsCapped?: boolean; meetingsCapped?: boolean; postingsCapped?: boolean; newsCapped?: boolean },
): T[] {
  const note = (kind: 'deals' | 'meetings' | 'news') => {
    const label = pulsePageNotes({
      dealsCapped: kind === 'deals',
      meetingsCapped: kind === 'meetings',
      newsCapped: kind === 'news',
    })[0];
    return label ? `${label}.` : '';
  };
  return drivers.map((driver) => {
    if (caps.postingsCapped && driver.key === 'hiring') {
      return { ...driver, detail: hiringPageDetail(driver.detail) };
    }
    const suffix =
      caps.dealsCapped && (driver.key === 'pipeline' || driver.key === 'winloss')
        ? note('deals')
        : caps.meetingsCapped && driver.key === 'meetings'
          ? note('meetings')
          : caps.newsCapped && driver.key === 'news'
            ? note('news')
            : '';
    return suffix ? { ...driver, detail: `${driver.detail} ${suffix}` } : driver;
  });
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

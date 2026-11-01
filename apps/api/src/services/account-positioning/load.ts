// Account positioning (v24): what to position, account brief facts, gaps and
// risks, and the key-numbers strip. Read only, built from data already held.
// Nothing is estimated: a number with no source comes back as null.
import { prisma } from '@bidstack/db';
import { recordedOutcome } from '../account-signals/load.js';
import { wonOutcomeWhere } from '../../routes/opportunities.helpers.js';
import { capDealSample, POSITIONING_DEAL_SAMPLE, sumMicrosAsNumber } from './micros.js';
import {
  buildGaps,
  buildPlays,
  cleanText,
  seniorityFromTitle,
  SENIOR,
  stripSamplePrefix,
  themeForText,
  tierLabel,
  type AccountKeyNumbers,
  type AccountPositioning,
  type BriefFacts,
  type FinancialPeriod,
  type FinancialSignalLite,
  type KeyNumber,
  type KnownPerson,
  type Seniority,
  type WonDeal,
} from '@bidstack/shared';

import type { AccessScope } from '../../lib/access-scope.js';
import { visibleMeetingWhere } from '../../meeting-intel/access.js';
import { loadAccountFinancials } from '../../routes/account-financials.js';
import { loadInitiatives } from '../account-signals/initiatives.js';
import { groupRollup, loadMomentumInputs, momentumFor } from '../account-signals/load.js';
import { companiesWithLiveSignals, hideSampleWhere } from '../account-signals/live-signals.js';

const DAY = 86_400_000;
const RISK_KINDS = ['RESTRUCTURING', 'LAYOFFS', 'LEADERSHIP_CHANGE', 'INSOLVENCY', 'GUIDANCE_CHANGE'] as const;
const SEN_ORDER: Seniority[] = ['c_level', 'vp', 'director', 'manager', 'ic', 'unknown'];
const SOURCE_LABEL: Record<string, string> = {
  gdelt: 'GDELT news',
  google_news: 'Google News',
  company_rss: 'Company newsroom',
  apify_linkedin: 'LinkedIn updates (provider)',
  financials: 'Filed financials',
  sec_edgar: 'SEC EDGAR',
  companies_house: 'Companies House',
  sample: 'Sample',
};
const sourceLabel = (s: string) => SOURCE_LABEL[s] ?? s.replace(/_/g, ' ');

interface Ctx {
  orgId: string;
  scope: AccessScope;
  companyId: string;
  now: Date;
}

/** Everyone we know at the account, merged by name: org chart, contacts, meeting attendees. */
async function loadPeople(c: Ctx, ids: string[]) {
  const since = new Date(c.now.getTime() - 730 * DAY);
  const [nodes, contacts, meetings, acts] = await Promise.all([
    prisma.orgChartNode.findMany({ where: { orgId: c.orgId, deletedAt: null, chart: { companyId: c.companyId } }, select: { name: true, title: true, seniority: true, contactId: true, kind: true }, take: 500 }),
    prisma.contact.findMany({ where: { orgId: c.orgId, companyId: { in: ids }, deletedAt: null }, select: { id: true, name: true, role: true }, take: 500 }),
    prisma.meetingIntel.findMany({
      where: { AND: [visibleMeetingWhere(c.orgId, c.scope), { companyId: { in: ids }, heldAt: { gte: since, lte: c.now } }] },
      select: { title: true, heldAt: true, attendees: { select: { name: true, title: true, seniority: true, contactId: true, isInternal: true } } },
      orderBy: { heldAt: 'desc' },
      take: 200,
    }),
    prisma.activity.findMany({
      where: { orgId: c.orgId, type: 'meeting', deletedAt: null, entityType: 'company', entityId: { in: ids }, OR: [{ startTime: { gte: since, lte: c.now } }, { startTime: null, occurredAt: { gte: since, lte: c.now } }] },
      select: { subject: true, startTime: true, occurredAt: true },
      orderBy: { occurredAt: 'desc' },
      take: 50,
    }),
  ]);
  const byKey = new Map<string, KnownPerson>();
  const key = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');
  const better = (a: Seniority, b: Seniority) => (SEN_ORDER.indexOf(a) <= SEN_ORDER.indexOf(b) ? a : b);
  const add = (p: KnownPerson) => {
    const k = key(p.name);
    if (!k) return;
    const cur = byKey.get(k);
    if (!cur) return void byKey.set(k, p);
    cur.title = cur.title ?? p.title;
    cur.seniority = better(cur.seniority, p.seniority);
    if (p.met && (!cur.lastMetAt || (p.lastMetAt ?? '') > cur.lastMetAt)) {
      cur.met = true;
      cur.lastMetAt = p.lastMetAt;
    }
  };
  for (const n of nodes) if (n.kind !== 'vacancy') add({ name: n.name, title: n.title, seniority: n.seniority === 'unknown' ? seniorityFromTitle(n.title) : n.seniority, met: false, lastMetAt: null, source: 'org_chart' });
  for (const ct of contacts) add({ name: ct.name, title: ct.role, seniority: seniorityFromTitle(ct.role), met: false, lastMetAt: null, source: 'contact' });
  const contactName = new Map(contacts.map((ct) => [ct.id, ct.name]));
  for (const m of meetings) {
    for (const a of m.attendees) {
      if (a.isInternal) continue;
      const name = (a.contactId && contactName.get(a.contactId)) || a.name;
      add({ name, title: a.title, seniority: a.seniority === 'unknown' ? seniorityFromTitle(a.title) : a.seniority, met: true, lastMetAt: m.heldAt.toISOString(), source: 'meeting' });
    }
  }
  const lastMeeting = [
    ...meetings.map((m) => ({ at: m.heldAt.toISOString(), title: cleanText(m.title) })),
    ...acts.map((a) => ({ at: (a.startTime ?? a.occurredAt).toISOString(), title: cleanText(a.subject ?? 'Meeting') })),
  ].sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
  return { people: [...byKey.values()], lastMeeting };
}

function finLite(fin: Awaited<ReturnType<typeof loadAccountFinancials>>): FinancialSignalLite[] {
  return fin.signals.map((s) => ({ rule: s.rule, title: s.title, confidence: s.confidence, periodEnd: s.periodEnd, sourceUrl: s.sourceUrl, sample: s.sample }));
}

const fyPeriods = (fin: Awaited<ReturnType<typeof loadAccountFinancials>>): FinancialPeriod[] =>
  fin.sample ? [] : fin.periods.filter((p) => p.periodType === 'FY').sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));

const pctChange = (cur: number | null | undefined, prev: number | null | undefined) =>
  cur != null && prev != null && prev !== 0 ? Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10 : null;

const marginOf = (p: FinancialPeriod) =>
  p.derived.operatingMargin != null ? { label: 'Operating margin', value: p.derived.operatingMargin } : p.derived.netMargin != null ? { label: 'Net margin', value: p.derived.netMargin } : null;

const STALE_DAYS = 548;
const WON_REFERENCE_SAMPLE = 1000;

async function accountIds(orgId: string, companyId: string) {
  const rollup = await groupRollup(orgId, [companyId]);
  return { ids: rollup.groups.get(companyId) ?? [companyId], childrenCapped: rollup.cappedRoots.has(companyId) };
}

export async function loadPositioning(orgId: string, scope: AccessScope, companyId: string, now = new Date()): Promise<AccountPositioning> {
  const c: Ctx = { orgId, scope, companyId, now };
  const { ids, childrenCapped } = await accountIds(orgId, companyId);
  const live = await companiesWithLiveSignals(orgId, ids);
  const since24 = new Date(now.getTime() - 730 * DAY);
  const [company, firmo, initiatives, fin, { people, lastMeeting }, opps, wonOrg, risky, topEvents, momentumIn, competitors] = await Promise.all([
    prisma.company.findFirstOrThrow({ where: { id: companyId, orgId }, select: { name: true, tier: true, industry: true, countryCode: true, employeeCount: true } }),
    prisma.companyFirmographics.findFirst({ where: { orgId, companyId }, select: { employeeCount: true, provenance: true } }),
    loadInitiatives(orgId, scope, { id: companyId }, now),
    loadAccountFinancials(orgId, companyId, false),
    loadPeople(c, ids),
    prisma.opportunity.findMany({
      where: { orgId, companyId: { in: ids }, deletedAt: null },
      select: {
        id: true,
        name: true,
        stage: true,
        valueMicros: true,
        createdAt: true,
        closedAt: true,
        updatedAt: true,
        pipelineStage: { select: { isWon: true, isLost: true, deletedAt: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: POSITIONING_DEAL_SAMPLE + 1,
    }),
    prisma.opportunity.findMany({
      where: { orgId, deletedAt: null, valueMicros: { gt: 0n }, ...wonOutcomeWhere() },
      select: { name: true, valueMicros: true, companyId: true },
      orderBy: { closedAt: 'desc' },
      take: WON_REFERENCE_SAMPLE,
    }),
    prisma.accountWatchEvent.findMany({
      where: { orgId, companyId: { in: ids }, status: { not: 'DISMISSED' }, kind: { in: [...RISK_KINDS] }, occurredAt: { gte: new Date(now.getTime() - 365 * DAY) }, ...hideSampleWhere(live) },
      select: { kind: true, title: true, occurredAt: true, sourceUrl: true, source: true, sample: true },
      orderBy: { occurredAt: 'desc' },
      take: 20,
    }),
    prisma.accountWatchEvent.findMany({
      where: { orgId, companyId: { in: ids }, status: { not: 'DISMISSED' }, occurredAt: { gte: new Date(now.getTime() - 180 * DAY), lte: now }, ...hideSampleWhere(live) },
      select: { title: true, occurredAt: true, source: true, sample: true, importance: true, severity: true },
      orderBy: [{ importance: 'desc' }, { occurredAt: 'desc' }],
      take: 1,
    }),
    loadMomentumInputs(orgId, scope, [companyId], now),
    prisma.competitorInsight.findMany({
      where: { orgId, deletedAt: null, opportunity: { companyId: { in: ids } } },
      select: { title: true, sourceUrl: true, publishedAt: true, competitorProfile: { select: { name: true } } },
      orderBy: { publishedAt: 'desc' },
      take: 10,
    }),
  ]);
  const loaded = momentumIn.get(companyId);
  const m = momentumFor(loaded, now);
  const momentum = m.coverage > 0 ? { score: m.score, delta: m.delta, trend: m.trend, sample: loaded?.sample ?? false } : null;
  const periods = fyPeriods(fin);
  const latest = periods[0];
  const prev = latest ? periods.find((p) => p.fiscalYear === latest.fiscalYear - 1) : undefined;
  const lm = latest ? marginOf(latest) : null;
  const pm = prev ? marginOf(prev) : null;
  const stale = !!latest && !!fin.lastPulledAt && Date.parse(fin.lastPulledAt) - Date.parse(`${latest.periodEnd}T00:00:00Z`) > STALE_DAYS * DAY;
  const finSignals = finLite(fin).filter((s) => !s.sample);
  const finSource = latest?.source ?? fin.entity?.source ?? null;

  const wonCapped = wonOrg.length === WON_REFERENCE_SAMPLE && (await prisma.opportunity.count({
    where: { orgId, deletedAt: null, valueMicros: { gt: 0n }, ...wonOutcomeWhere() },
  })) > WON_REFERENCE_SAMPLE;
  const wonRows = wonOrg;
  const won: WonDeal[] = wonRows.map((o) => ({ name: o.name, valueMicros: o.valueMicros ?? 0n, here: !!o.companyId && ids.includes(o.companyId) }));
  const plays = buildPlays({ initiatives, financialSignals: finSignals, financialSource: finSource, people, won, wonSampleLimit: wonCapped ? WON_REFERENCE_SAMPLE : null, themeOf: themeForText, now });

  const dealSample = capDealSample(opps);
  const deals = dealSample.rows;
  const outcomeOf = (o: (typeof deals)[number]) => recordedOutcome(o);
  const open = deals.filter((o) => outcomeOf(o) === 'open');
  const closed24 = deals.filter((o) => {
    if (outcomeOf(o) === 'open') return false;
    return (o.closedAt ?? o.updatedAt) >= since24;
  });
  const seniorPeople = people.filter((p) => SENIOR.has(p.seniority));
  const employees = firmo?.employeeCount
    ? { value: firmo.employeeCount, source: 'Enrichment cache' }
    : company.employeeCount
      ? { value: company.employeeCount, source: 'Account record' }
      : null;
  const top = topEvents[0];
  const brief: BriefFacts = {
    name: company.name,
    tierLabel: tierLabel(company.tier),
    industry: company.industry,
    country: company.countryCode,
    employees,
    momentum,
    financials:
      latest && latest.metrics.revenue
        ? {
            fiscalYear: latest.fiscalYear,
            source: latest.source,
            currency: latest.currency,
            revenue: latest.metrics.revenue.value,
            revenueYoY: pctChange(latest.metrics.revenue.value, prev?.metrics.revenue?.value),
            marginLabel: lm?.label ?? null,
            margin: lm?.value ?? null,
            marginDelta: lm && pm && lm.label === pm.label ? Math.round((lm.value - pm.value) * 10) / 10 : null,
            stale,
          }
        : null,
    pipeline: {
      openCount: open.length,
      openMicros: open.reduce((s, o) => s + (o.valueMicros ?? 0n), 0n).toString(),
      won24m: closed24.filter((o) => outcomeOf(o) === 'won').length,
      lost24m: closed24.filter((o) => outcomeOf(o) === 'lost').length,
      latest: dealSample.capped ? POSITIONING_DEAL_SAMPLE : null,
    },
    people: {
      known: people.length,
      senior: seniorPeople.length,
      metLast12m: people.filter((p) => p.met && p.lastMetAt && now.getTime() - Date.parse(p.lastMetAt) < 365 * DAY).length,
      lastMeeting,
    },
    topSignal: top ? { title: cleanText(stripSamplePrefix(top.title)), at: top.occurredAt.toISOString(), source: sourceLabel(top.source), sample: top.sample } : null,
    subsidiariesCapped: childrenCapped,
  };
  const gaps = buildGaps({
    people,
    lastMeetingAt: lastMeeting?.at ?? null,
    momentum,
    openDeals: open.length,
    riskEvents: risky.map((e) => ({ kind: e.kind, title: cleanText(stripSamplePrefix(e.title)), at: e.occurredAt.toISOString(), url: e.sourceUrl || null, source: sourceLabel(e.source), sample: e.sample })),
    competitorMentions: competitors.map((ci) => ({ competitor: ci.competitorProfile.name, title: cleanText(ci.title), at: ci.publishedAt ? ci.publishedAt.toISOString() : null, url: ci.sourceUrl || null, source: 'Competitor intel' })),
    financialRisks: finSignals.filter((s) => fin.signals.find((x) => x.rule === s.rule && x.title === s.title)?.implication === 'RISK'),
    financialStaleFy: stale && latest ? latest.fiscalYear : null,
    financialSource: finSource,
    dealSampleLimit: dealSample.capped ? POSITIONING_DEAL_SAMPLE : null,
    now,
  });
  return { companyId, plays, brief, gaps, sample: plays.length > 0 && plays.every((p) => p.sample), computedAt: now.toISOString() };
}

// ── key numbers ─────────────────────────────────────────────────────────────

const base = (over: Partial<KeyNumber> & Pick<KeyNumber, 'id' | 'group' | 'label' | 'unit' | 'source' | 'period'>): KeyNumber => ({
  value: null,
  currency: null,
  delta: null,
  deltaUnit: null,
  goodWhen: 'up',
  series: [],
  sub: null,
  sourceUrl: null,
  anchor: null,
  missing: null,
  sample: false,
  ...over,
});

/** Month buckets (oldest first) counting dates in each of the last n months. */
function monthly(dates: Date[], now: Date, n: number): number[] {
  const out = new Array<number>(n).fill(0);
  const y = now.getUTCFullYear();
  const mo = now.getUTCMonth();
  for (const d of dates) {
    const idx = n - 1 - ((y - d.getUTCFullYear()) * 12 + (mo - d.getUTCMonth()));
    if (idx >= 0 && idx < n) out[idx]! += 1;
  }
  return out;
}

export async function loadKeyNumbers(orgId: string, scope: AccessScope, companyId: string, now = new Date()): Promise<AccountKeyNumbers> {
  const c: Ctx = { orgId, scope, companyId, now };
  const { ids, childrenCapped } = await accountIds(orgId, companyId);
  const live = await companiesWithLiveSignals(orgId, ids);
  const d90 = new Date(now.getTime() - 90 * DAY);
  const d180 = new Date(now.getTime() - 180 * DAY);
  const [company, firmo, fin, rawPostings, opps, news, momentumIn, { people, lastMeeting }] = await Promise.all([
    prisma.company.findFirstOrThrow({ where: { id: companyId, orgId }, select: { employeeCount: true, updatedAt: true } }),
    prisma.companyFirmographics.findFirst({ where: { orgId, companyId }, select: { employeeCount: true, headcountGrowth12m: true, annualRevenueUsd: true, fetchedAt: true, provenance: true } }),
    loadAccountFinancials(orgId, companyId, false),
    prisma.companyJobPosting.findMany({ where: { orgId, companyId: { in: ids }, postedAt: { gte: new Date(now.getTime() - 365 * DAY) } }, select: { postedAt: true, lastSeenAt: true }, take: 1000 }),
    prisma.opportunity.findMany({
      where: { orgId, companyId: { in: ids }, deletedAt: null },
      select: {
        stage: true,
        valueMicros: true,
        createdAt: true,
        closedAt: true,
        updatedAt: true,
        pipelineStage: { select: { isWon: true, isLost: true, deletedAt: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: POSITIONING_DEAL_SAMPLE + 1,
    }),
    prisma.accountWatchEvent.findMany({
      where: { orgId, companyId: { in: ids }, status: { not: 'DISMISSED' }, sentiment: { not: null }, occurredAt: { gte: d180, lte: now }, ...hideSampleWhere(live) },
      select: { sentiment: true, occurredAt: true, sample: true, source: true },
      take: 1000,
    }),
    loadMomentumInputs(orgId, scope, [companyId], now),
    loadPeople(c, ids),
  ]);
  const items: KeyNumber[] = [];
  const postings = rawPostings.flatMap((p) => (p.postedAt ? [{ postedAt: p.postedAt, lastSeenAt: p.lastSeenAt }] : []));
  const periods = fyPeriods(fin);
  const asc = [...periods].reverse();
  const latest = periods[0];
  const prev = latest ? periods.find((p) => p.fiscalYear === latest.fiscalYear - 1) : undefined;
  const fy = (p: FinancialPeriod) => `FY${p.fiscalYear} (to ${p.periodEnd})`;
  const finMissing = fin.gate === 'general' ? 'Financials are tracked for Strategic and Top accounts' : fin.statusCopy ?? 'No filed statements yet';

  // Employees: filings, then enrichment cache, then the account record.
  const hc = latest?.metrics.headcount;
  if (hc && latest) {
    items.push(base({ id: 'employees', group: 'company', label: 'Employees', unit: 'count', value: hc.value, delta: pctChange(hc.value, prev?.metrics.headcount?.value), deltaUnit: 'pct', series: asc.map((p) => p.metrics.headcount?.value ?? NaN).filter(Number.isFinite), source: latest.source, period: `${fy(latest)}, change vs prior year`, sourceUrl: latest.sourceUrl, anchor: 'financial-health' }));
  } else if (firmo?.employeeCount) {
    items.push(base({ id: 'employees', group: 'company', label: 'Employees', unit: 'count', value: firmo.employeeCount, delta: firmo.headcountGrowth12m != null ? Math.round(firmo.headcountGrowth12m * 1000) / 10 : null, deltaUnit: 'pct', source: 'Enrichment cache', period: `As of ${firmo.fetchedAt ? firmo.fetchedAt.toISOString().slice(0, 10) : 'last refresh'}, change over 12 months`, anchor: 'firmographics' }));
  } else if (company.employeeCount) {
    items.push(base({ id: 'employees', group: 'company', label: 'Employees', unit: 'count', value: company.employeeCount, source: 'Account record', period: 'Entered on the account, no trend yet' }));
  } else items.push(base({ id: 'employees', group: 'company', label: 'Employees', unit: 'count', source: 'None', period: 'n/a', missing: 'No headcount on record' }));

  // Revenue, with YoY.
  const rev = latest?.metrics.revenue;
  if (rev && latest) {
    items.push(base({ id: 'revenue', group: 'company', label: 'Revenue', unit: 'money', currency: latest.currency, value: rev.value, delta: pctChange(rev.value, prev?.metrics.revenue?.value), deltaUnit: 'pct', series: asc.map((p) => p.metrics.revenue?.value ?? NaN).filter(Number.isFinite), source: latest.source, period: `${fy(latest)}, change vs prior year`, sourceUrl: latest.sourceUrl, anchor: 'financial-health' }));
  } else if (firmo?.annualRevenueUsd) {
    items.push(base({ id: 'revenue', group: 'company', label: 'Revenue', unit: 'money', currency: 'USD', value: Number(firmo.annualRevenueUsd), source: 'Enrichment cache', period: `Annual, as of ${firmo.fetchedAt ? firmo.fetchedAt.toISOString().slice(0, 10) : 'last refresh'}`, anchor: 'firmographics' }));
  } else items.push(base({ id: 'revenue', group: 'company', label: 'Revenue', unit: 'money', source: 'None', period: 'n/a', missing: finMissing }));

  // Margin trend.
  const lm = latest ? marginOf(latest) : null;
  if (lm && latest) {
    const pm = prev ? marginOf(prev) : null;
    const series = asc.map((p) => (lm.label === 'Operating margin' ? p.derived.operatingMargin : p.derived.netMargin)).filter((v): v is number => v != null);
    items.push(base({ id: 'margin', group: 'company', label: lm.label, unit: 'pct', value: Math.round(lm.value * 10) / 10, delta: pm && pm.label === lm.label ? Math.round((lm.value - pm.value) * 10) / 10 : null, deltaUnit: 'pts', series, source: `${latest.source}, derived by Polo`, period: `${fy(latest)}, change vs prior year`, sourceUrl: latest.sourceUrl, anchor: 'financial-health' }));
  } else items.push(base({ id: 'margin', group: 'company', label: 'Margin', unit: 'pct', source: 'None', period: 'n/a', missing: latest ? 'No margin in the filed numbers' : finMissing }));

  // Open jobs and hiring trend.
  const openJobs = postings.filter((p) => (p.lastSeenAt ?? p.postedAt) >= new Date(now.getTime() - 45 * DAY)).length;
  const last90 = postings.filter((p) => p.postedAt >= d90).length;
  const prev90 = postings.filter((p) => p.postedAt >= d180 && p.postedAt < d90).length;
  if (postings.length) {
    items.push(base({ id: 'open_jobs', group: 'company', label: 'Open jobs', unit: 'count', value: openJobs, delta: pctChange(last90, prev90), deltaUnit: 'pct', series: monthly(postings.map((p) => p.postedAt), now, 6), sub: `${last90} posted in 90 days`, source: 'Job postings cache', period: 'Seen in 45 days; trend is last 90 days vs the 90 before', anchor: 'hiring-now' }));
  } else items.push(base({ id: 'open_jobs', group: 'company', label: 'Open jobs', unit: 'count', source: 'None', period: 'n/a', missing: 'No job postings tracked yet' }));

  // Momentum.
  const loaded = momentumIn.get(companyId);
  const m = momentumFor(loaded, now);
  items.push(
    m.coverage > 0
      ? base({ id: 'momentum', group: 'health', label: 'Momentum', unit: 'score', value: m.score, delta: m.delta, deltaUnit: 'pts', series: m.series.map((s) => s.score), sub: m.trend === 'gaining' ? 'Gaining' : m.trend === 'declining' ? 'Declining' : 'Steady', source: 'Polo account pulse', period: 'Now, change over 4 weeks', anchor: 'pulse', sample: loaded?.sample ?? false })
      : base({ id: 'momentum', group: 'health', label: 'Momentum', unit: 'score', source: 'Polo account pulse', period: 'n/a', missing: 'Not enough signals yet' }),
  );

  // Senior contact coverage.
  const senior = people.filter((p) => SENIOR.has(p.seniority));
  const metSenior = senior.filter((p) => p.met && p.lastMetAt && now.getTime() - Date.parse(p.lastMetAt) < 365 * DAY);
  items.push(base({ id: 'senior_coverage', group: 'health', label: 'Senior contacts met', unit: 'count', value: metSenior.length, sub: `of ${senior.length} senior (C-level, VP) known`, source: 'Org chart, contacts and meeting intel', period: 'Met in the last 12 months', anchor: 'who-we-met' }));

  // Last meeting recency.
  if (lastMeeting) {
    const days = Math.max(0, Math.floor((now.getTime() - Date.parse(lastMeeting.at)) / DAY));
    items.push(base({ id: 'last_meeting', group: 'health', label: 'Last meeting', unit: 'days', value: days, goodWhen: 'down', sub: lastMeeting.title, source: 'Meeting intel and logged meetings', period: `On ${lastMeeting.at.slice(0, 10)}`, anchor: 'who-we-met' }));
  } else items.push(base({ id: 'last_meeting', group: 'health', label: 'Last meeting', unit: 'days', goodWhen: 'down', source: 'Meeting intel and logged meetings', period: 'Last 24 months', missing: 'No meeting logged' }));

  // Pipeline value and trend: open value now vs reconstructed 90 days ago.
  const dealSample = capDealSample(opps);
  const deals = dealSample.rows;
  const outcomeOf = (o: (typeof deals)[number]) => recordedOutcome(o);
  const open = deals.filter((o) => outcomeOf(o) === 'open');
  const openAt = (t: Date) =>
    sumMicrosAsNumber(
      deals
        .filter((o) => o.createdAt <= t && (outcomeOf(o) === 'open' ? true : (o.closedAt ?? o.updatedAt) > t))
        .map((o) => o.valueMicros),
    );
  const nowOpen = sumMicrosAsNumber(open.map((o) => o.valueMicros));
  const series = [150, 120, 90, 60, 30].map((d) => openAt(new Date(now.getTime() - d * DAY))).concat(nowOpen);
  const ago = series[2];
  if (nowOpen == null || ago == null || series.some((point) => point == null)) {
    items.push(
      base({
        id: 'pipeline',
        group: 'health',
        label: 'Open pipeline',
        unit: 'money_micros',
        source: 'Polo pipeline',
        period: 'Now, change vs 90 days ago',
        anchor: 'deals',
        missing: 'Open pipeline does not fit in one number',
        sub: childrenCapped ? 'latest 1,000 subsidiaries' : null,
      }),
    );
  } else {
    items.push(
      base({
        id: 'pipeline',
        group: 'health',
        label: 'Open pipeline',
        unit: 'money_micros',
        value: nowOpen,
        delta: pctChange(nowOpen, ago),
        deltaUnit: 'pct',
        series: series.filter((point): point is number => point != null),
        sub: [
          dealSample.capped ? `${open.length} open deals in the latest ${POSITIONING_DEAL_SAMPLE}` : `${open.length} open deals`,
          childrenCapped ? 'latest 1,000 subsidiaries' : '',
        ].filter(Boolean).join(' · '),
        source: 'Polo pipeline',
        period: 'Now, change vs 90 days ago',
        anchor: 'deals',
      }),
    );
  }

  // Financial warnings.
  const warnings = fin.sample ? [] : fin.signals.filter((s) => s.implication === 'RISK' && !s.sample);
  items.push(
    periods.length
      ? base({ id: 'fin_warnings', group: 'health', label: 'Financial warnings', unit: 'count', value: warnings.length, goodWhen: 'down', sub: warnings[0]?.title ?? 'None in the latest filings', source: latest?.source ?? 'Filed financials', period: latest ? `Latest filings, ${fy(latest)}` : 'n/a', anchor: 'financial-health' })
      : base({ id: 'fin_warnings', group: 'health', label: 'Financial warnings', unit: 'count', goodWhen: 'down', source: 'Filed financials', period: 'n/a', missing: finMissing }),
  );

  // News sentiment: mean over 90 days vs the 90 before.
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const recent = news.filter((n) => n.occurredAt >= d90).map((n) => n.sentiment!);
  const before = news.filter((n) => n.occurredAt < d90).map((n) => n.sentiment!);
  const sNow = mean(recent);
  const sPrev = mean(before);
  items.push(
    sNow != null
      ? base({ id: 'sentiment', group: 'health', label: 'News sentiment', unit: 'sentiment', value: Math.round(sNow * 100) / 100, delta: sPrev != null ? Math.round((sNow - sPrev) * 100) / 100 : null, deltaUnit: 'abs', sub: `${recent.length} scored item${recent.length === 1 ? '' : 's'}`, source: [...new Set(news.map((n) => sourceLabel(n.source)))].slice(0, 3).join(', '), period: 'Last 90 days vs the 90 before, scale -1 to +1', anchor: 'watchdog', sample: news.filter((n) => n.occurredAt >= d90).every((n) => n.sample) })
      : base({ id: 'sentiment', group: 'health', label: 'News sentiment', unit: 'sentiment', source: 'News watchdog', period: 'Last 90 days', missing: 'No scored news in 90 days', anchor: 'watchdog' }),
  );
  return { companyId, items, computedAt: now.toISOString() };
}


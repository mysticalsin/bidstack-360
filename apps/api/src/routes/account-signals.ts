// Account signals (v21): pulse (momentum), signals timeline, inferred
// initiatives and portfolio momentum. Read only, org scoped, gated by
// accounts:read plus account visibility. Contract: /workspace/fleet/polo-signals-api.md
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import {
  AccountInitiatives,
  AccountKeyNumbers,
  AccountPositioning,
  AccountPulse,
  AccountTimeline,
  categoryForKind,
  cleanText,
  PortfolioMomentum,
  SignalCategory,
  stripSamplePrefix,
  type Implication,
  type PortfolioAlert,
  type TimelineItem,
  collapseMarketNotes,
} from '@bidstack/shared';

import { canReadAccount } from '../lib/account-access.js';
import { applyCompanyScope, getAccessScope } from '../lib/access-scope.js';
import { visibleMeetingWhere } from '../meeting-intel/access.js';
import {
  annotatePulseRead,
  closedAtOf,
  groupMap,
  groupRollup,
  loadMomentumInputs,
  momentumFor,
  OPP_SELECT,
  pageIsCapped,
  recordedOutcome,
  sourceStatus,
} from '../services/account-signals/load.js';
import { companiesWithLiveSignals, hideSampleWhere } from '../services/account-signals/live-signals.js';
import { buyerNamesAccount } from '../services/account-signals/bid-name.js';
import { hiringSpikeWeeks } from '../services/account-signals/hiring-spike.js';
import { loadInitiatives } from '../services/account-signals/initiatives.js';
import { loadKeyNumbers, loadPositioning } from '../services/account-positioning/load.js';

const DAY = 86_400_000;
const params = z.object({ companyId: z.string().uuid() });

const importanceOf = (e: { importance: number; severity: number }) => e.importance || Math.min(100, e.severity * 20);

const escapeLike = (s: string) => s.replace(/[%_\\]/g, (c) => `\\${c}`);

export const accountSignalsRoutes: FastifyPluginAsyncZod = async (server) => {
  async function readable(req: { auth: { orgId: string; userId: string } }, companyId: string) {
    const { orgId, userId } = req.auth;
    const company = await prisma.company.findFirst({ where: { id: companyId, orgId, deletedAt: null }, select: { id: true, name: true } });
    if (!company) throw server.httpErrors.notFound('Account not found');
    const access = await canReadAccount({ orgId, userId, companyId, accountName: company.name });
    if (!access.allowed) throw server.httpErrors.notFound('Account not found');
    return company;
  }

  server.get(
    '/accounts/:companyId/pulse',
    { preHandler: [server.requirePermission('accounts:read')], schema: { params, response: { 200: AccountPulse } } },
    async (req) => {
      const { orgId, userId } = req.auth;
      const company = await readable(req, req.params.companyId);
      const scope = await getAccessScope(orgId, userId);
      const now = new Date();
      const loaded = await loadMomentumInputs(orgId, scope, [company.id], now);
      const row = loaded.get(company.id);
      const m = momentumFor(row, now);
      return {
        companyId: company.id,
        companyName: company.name,
        score: m.score,
        delta: m.delta,
        trend: m.trend,
        verdict: m.verdict,
        coverage: m.coverage,
        series: m.series,
        drivers: annotatePulseRead(m.drivers.slice(0, 5), {
          dealsCapped: row?.dealsCapped,
          meetingsCapped: row?.meetingsCapped,
          postingsCapped: row?.postingsCapped,
          newsCapped: row?.newsCapped,
        }),
        sample: row?.sample ?? false,
        dealsCapped: row?.dealsCapped ?? false,
        feedsCapped: row?.feedsCapped ?? false,
        meetingsCapped: row?.meetingsCapped ?? false,
        postingsCapped: row?.postingsCapped ?? false,
        newsCapped: row?.newsCapped ?? false,
        childrenCapped: row?.childrenCapped ?? false,
        sources: await sourceStatus(orgId, company.id),
        computedAt: now.toISOString(),
      };
    },
  );

  server.get(
    '/accounts/:companyId/timeline',
    {
      preHandler: [server.requirePermission('accounts:read')],
      schema: {
        params,
        querystring: z.object({
          categories: z.string().max(300).optional(),
          days: z.coerce.number().int().min(30).max(730).default(365),
        }),
        response: { 200: AccountTimeline },
      },
    },
    async (req) => {
      const { orgId, userId } = req.auth;
      const company = await readable(req, req.params.companyId);
      const scope = await getAccessScope(orgId, userId);
      const now = new Date();
      const from = new Date(now.getTime() - req.query.days * DAY);
      const to = new Date(now.getTime() + 90 * DAY);
      const ids = (await groupMap(orgId, [company.id])).get(company.id) ?? [company.id];
      const live = await companiesWithLiveSignals(orgId, ids);
      const wanted = req.query.categories
        ? new Set(req.query.categories.split(',').map((c) => c.trim()).filter((c) => SignalCategory.safeParse(c).success))
        : null;
      const [meetingPage, oppPage, bidPage, eventPage, earnings, postingPage] = await Promise.all([
        (async () => {
          const where = { AND: [visibleMeetingWhere(orgId, scope), { companyId: { in: ids }, heldAt: { gte: from, lte: to } }] };
          const rows = await prisma.meetingIntel.findMany({
            where,
            select: { id: true, title: true, heldAt: true, summary: true, companyId: true, _count: { select: { attendees: true } } },
            orderBy: { heldAt: 'desc' },
            take: 200,
          });
          const capped = rows.length === 200 && pageIsCapped(rows.length, await prisma.meetingIntel.count({ where }), 200);
          return { rows, capped };
        })(),
        (async () => {
          const where = { orgId, companyId: { in: ids }, deletedAt: null };
          const rows = await prisma.opportunity.findMany({
            where,
            select: OPP_SELECT,
            orderBy: { updatedAt: 'desc' },
            take: 1000,
          });
          const capped = rows.length === 1000 && pageIsCapped(rows.length, await prisma.opportunity.count({ where }), 1000);
          return { rows, capped };
        })(),
        (async () => {
          const where = { orgId, deletedAt: null, buyer: { contains: escapeLike(company.name), mode: 'insensitive' as const }, OR: [{ importedAt: { gte: from } }, { dueDate: { gte: from } }] };
          const rows = await prisma.bidOpportunity.findMany({
            where,
            select: { id: true, title: true, buyer: true, status: true, dueDate: true, importedAt: true, url: true, estimatedValueMicros: true },
            orderBy: { importedAt: 'desc' },
            take: 1000,
          });
          const named = rows.filter((row) => buyerNamesAccount(row.buyer, company.name));
          const searchCapped = rows.length === 1000 && pageIsCapped(rows.length, await prisma.bidOpportunity.count({ where }), 1000);
          return { rows: named.slice(0, 100), capped: named.length > 100, searchCapped };
        })(),
        (async () => {
          const where = { orgId, companyId: { in: ids }, status: { not: 'DISMISSED' as const }, occurredAt: { gte: from, lte: to }, ...hideSampleWhere(live) };
          const rows = await prisma.accountWatchEvent.findMany({
            where,
            orderBy: { occurredAt: 'desc' },
            take: 300,
          });
          const capped = rows.length === 300 && pageIsCapped(rows.length, await prisma.accountWatchEvent.count({ where }), 300);
          return { rows, capped };
        })(),
        prisma.accountEarningsDate.findMany({ where: { orgId, companyId: { in: ids }, expectedAt: { gte: from, lte: to } }, take: 20 }),
        (async () => {
          const where = { orgId, companyId: { in: ids }, postedAt: { gte: from } };
          const rows = await prisma.companyJobPosting.findMany({
            where,
            select: { postedAt: true },
            orderBy: { postedAt: 'desc' },
            take: 1000,
          });
          const capped = rows.length === 1000 && pageIsCapped(rows.length, await prisma.companyJobPosting.count({ where }), 1000);
          return { rows, capped };
        })(),
      ]);
      const items: TimelineItem[] = [];
      const push = (i: Omit<TimelineItem, 'upcoming'>) => items.push({ ...i, upcoming: new Date(i.at).getTime() > now.getTime() });
      const meetings = meetingPage.rows;
      for (const m of meetings) {
        push({
          id: `mt:${m.id}`,
          at: m.heldAt.toISOString(),
          lane: 'ours',
          category: 'meeting',
          title: m.title,
          summary: m.summary ? m.summary.slice(0, 200) : `${m._count.attendees} attendee${m._count.attendees === 1 ? '' : 's'}`,
          source: 'Meeting intel',
          sourceUrl: null,
          href: `/meetings?account=${m.companyId}`,
          importance: 40,
          implication: 'NEUTRAL',
          sample: false,
        });
      }
      const opps = oppPage.rows;
      for (const o of opps) {
        if (o.createdAt >= from) {
          push({ id: `op:${o.id}:open`, at: o.createdAt.toISOString(), lane: 'ours', category: 'deal', title: `Deal opened: ${o.name}`, summary: `Stage ${o.stage.replace(/_/g, ' ')}`, source: 'Pipeline', sourceUrl: null, href: `/opportunities/${o.id}`, importance: 45, implication: 'NEUTRAL', sample: false });
        }
        const closed = closedAtOf(o);
        if (closed && closed >= from) {
          const won = recordedOutcome(o) === 'won';
          push({ id: `op:${o.id}:close`, at: closed.toISOString(), lane: 'ours', category: 'deal', title: `${won ? 'Won' : 'Lost'}: ${o.name}`, summary: won ? 'Closed won' : 'Closed lost', source: 'Pipeline', sourceUrl: null, href: `/opportunities/${o.id}`, importance: won ? 70 : 60, implication: won ? 'OPPORTUNITY' : 'RISK', sample: false });
        }
      }
      const bids = bidPage.rows;
      for (const b of bids) {
        push({ id: `bid:${b.id}`, at: (b.dueDate ?? b.importedAt).toISOString(), lane: 'ours', category: 'bid', title: `Bid: ${b.title}`, summary: b.dueDate ? `Due ${b.dueDate.toISOString().slice(0, 10)}, ${b.status}` : b.status, source: 'Bids', sourceUrl: b.url, href: '/bid-matrix', importance: 50, implication: 'NEUTRAL', sample: false });
      }
      const events = eventPage.rows;
      for (const e of events) {
        push({
          id: `ev:${e.id}`,
          at: e.occurredAt.toISOString(),
          lane: 'theirs',
          category: categoryForKind(e.kind, e.implication as Implication),
          title: cleanText(stripSamplePrefix(e.title)),
          summary: cleanText(e.summary),
          source: e.source,
          sourceUrl: e.sourceUrl || null,
          href: null,
          importance: importanceOf(e),
          implication: e.implication as Implication,
          sample: e.sample,
        });
      }
      for (const d of earnings) {
        push({ id: `er:${d.id}`, at: d.expectedAt.toISOString(), lane: 'theirs', category: 'earnings', title: `Results ${d.fiscalPeriod}${d.confirmed ? '' : ' (expected)'}`, summary: d.confirmed ? 'Confirmed date' : 'Estimated date', source: d.source, sourceUrl: d.sourceUrl || null, href: null, importance: 45, implication: 'NEUTRAL', sample: d.source === 'sample' });
      }
      // Hiring spikes: weeks with at least 5 postings and twice the median week.
      // A capped page does not invent 0 for weeks it never read.
      const weeks = new Map<number, number>();
      const postings = postingPage.rows;
      for (const p of postings) if (p.postedAt) weeks.set(Math.floor(p.postedAt.getTime() / (7 * DAY)), (weeks.get(Math.floor(p.postedAt.getTime() / (7 * DAY))) ?? 0) + 1);
      for (const spike of hiringSpikeWeeks(weeks, req.query.days, postingPage.capped)) {
        push({ id: `hire:${spike.week}`, at: new Date(spike.week * 7 * DAY + 3 * DAY).toISOString(), lane: 'theirs', category: 'hiring', title: `Hiring spike: ${spike.count} roles posted in one week`, summary: postingPage.capped ? `Typical week in the latest 1,000 posts: ${spike.median}` : `Typical week: ${spike.median}`, source: 'Job postings', sourceUrl: null, href: null, importance: 55, implication: 'OPPORTUNITY', sample: false });
      }
      // v22.1: several analyst notes in a week read as one row.
      const grouped = collapseMarketNotes(
        [...items].sort((a, b) => b.at.localeCompare(a.at)),
        {
          now: new Date(),
          isMarket: (i) => i.category === 'market' && !i.sample,
          at: (i) => new Date(i.at),
          merge: (g, title) => ({
            ...g[0]!,
            id: `grp:market:${g[0]!.id}`,
            title,
            summary: g.slice(0, 5).map((x) => x.title).join('; '),
            importance: Math.max(...g.map((x) => x.importance)),
            implication: g.some((x) => x.implication === 'RISK') ? ('RISK' as const) : ('NEUTRAL' as const),
            groupCount: g.length,
          }),
        },
      );
      const tally: Record<string, number> = {};
      for (const i of grouped) tally[i.category] = (tally[i.category] ?? 0) + 1;
      const pool = wanted ? grouped.filter((i) => wanted.has(i.category)) : grouped;
      const shown = pool.slice(0, 300);
      return {
        companyId: company.id,
        from: from.toISOString(),
        to: to.toISOString(),
        items: shown,
        counts: tally,
        dealsCapped: oppPage.capped,
        meetingsCapped: meetingPage.capped,
        newsCapped: eventPage.capped,
        bidsCapped: bidPage.capped,
        bidsSearchCapped: bidPage.searchCapped,
        marksCapped: pool.length > shown.length,
        postingsCapped: postingPage.capped,
      };
    },
  );

  server.get(
    '/accounts/:companyId/initiatives',
    { preHandler: [server.requirePermission('accounts:read')], schema: { params, response: { 200: AccountInitiatives } } },
    async (req) => {
      const { orgId, userId } = req.auth;
      const company = await readable(req, req.params.companyId);
      const scope = await getAccessScope(orgId, userId);
      const rollup = await groupRollup(orgId, [company.id]);
      const ids = rollup.groups.get(company.id) ?? [company.id];
      const loaded = await loadInitiatives(orgId, scope, company, new Date(), ids);
      return {
        companyId: company.id,
        items: loaded.items,
        subsidiariesCapped: rollup.cappedRoots.has(company.id),
        evidenceCapped: loaded.evidenceCapped,
        solutionsCapped: loaded.solutionsCapped,
      };
    },
  );

  server.get(
    '/accounts/:companyId/positioning',
    { preHandler: [server.requirePermission('accounts:read')], schema: { params, response: { 200: AccountPositioning } } },
    async (req) => {
      const { orgId, userId } = req.auth;
      const company = await readable(req, req.params.companyId);
      return loadPositioning(orgId, await getAccessScope(orgId, userId), company.id);
    },
  );

  server.get(
    '/accounts/:companyId/key-numbers',
    { preHandler: [server.requirePermission('accounts:read')], schema: { params, response: { 200: AccountKeyNumbers } } },
    async (req) => {
      const { orgId, userId } = req.auth;
      const company = await readable(req, req.params.companyId);
      return loadKeyNumbers(orgId, await getAccessScope(orgId, userId), company.id);
    },
  );

  server.get(
    '/portfolio/momentum',
    {
      preHandler: [server.requirePermission('accounts:read')],
      schema: { querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(40) }), response: { 200: PortfolioMomentum } },
    },
    async (req) => {
      const { orgId, userId } = req.auth;
      const scope = await getAccessScope(orgId, userId);
      const now = new Date();
      const roots = await prisma.company.findMany({
        where: applyCompanyScope(
          {
            orgId,
            deletedAt: null,
            parentId: null,
            OR: [
              { opportunities: { some: { deletedAt: null } } },
              { accountWatchEvents: { some: {} } },
              { firmographics: { isNot: null } },
              { meetingIntel: { some: { deletedAt: null } } },
              { children: { some: { meetingIntel: { some: { deletedAt: null } } } } },
            ],
          },
          scope,
        ),
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
        take: req.query.limit,
      });
      const loaded = await loadMomentumInputs(orgId, scope, roots.map((r) => r.id), now);
      const accounts = roots
        .map((r) => {
          const l = loaded.get(r.id);
          const m = momentumFor(l, now);
          return {
            companyId: r.id,
            companyName: r.name,
            score: m.score,
            delta: m.delta,
            trend: m.trend,
            verdict: m.verdict,
            topDriver: m.drivers[0]?.detail ?? null,
            openPipelineMicros: (l?.openPipelineMicros ?? 0n).toString(),
            dealsCapped: l?.dealsCapped ?? false,
            feedsCapped: l?.feedsCapped ?? false,
            meetingsCapped: l?.meetingsCapped ?? false,
            postingsCapped: l?.postingsCapped ?? false,
            newsCapped: l?.newsCapped ?? false,
            childrenCapped: l?.childrenCapped ?? false,
            series: m.series.slice(-8).map((p) => p.score),
            sample: l?.sample ?? false,
            coverage: m.coverage,
          };
        })
        .sort((a, b) => b.delta - a.delta || b.score - a.score);
      const ids = roots.map((r) => r.id);
      const names = new Map(roots.map((r) => [r.id, r.name]));
      const groups = await groupMap(orgId, ids);
      const owner = new Map<string, string>();
      for (const [root, members] of groups) for (const m of members) owner.set(m, root);
      const live = await companiesWithLiveSignals(orgId, [...owner.keys()]);
      const rows = owner.size
        ? await prisma.accountWatchEvent.findMany({
            where: {
              orgId,
              companyId: { in: [...owner.keys()] },
              status: 'NEW',
              occurredAt: { gte: new Date(now.getTime() - 45 * DAY), lte: now },
              ...hideSampleWhere(live),
              OR: [{ importance: { gte: 60 } }, { importance: 0, severity: { gte: 3 } }],
            },
            orderBy: [{ importance: 'desc' }, { occurredAt: 'desc' }],
            take: 40,
          })
        : [];
      // Rank in memory: legacy rows (importance 0) score from severity.
      const ranked = rows
        .map((e) => ({ e, imp: importanceOf(e) }))
        .sort((a, b) => b.imp - a.imp || b.e.occurredAt.getTime() - a.e.occurredAt.getTime())
        .slice(0, 8)
        .map((r) => r.e);
      const alerts: PortfolioAlert[] = ranked.map((e) => {
        const root = owner.get(e.companyId) ?? e.companyId;
        return {
          id: e.id,
          companyId: root,
          companyName: names.get(root) ?? '',
          title: cleanText(stripSamplePrefix(e.title)),
          category: categoryForKind(e.kind, e.implication as Implication),
          importance: importanceOf(e),
          occurredAt: e.occurredAt.toISOString(),
          source: e.source,
          sourceUrl: e.sourceUrl || null,
          implication: e.implication as Implication,
          sample: e.sample,
        };
      });
      const counts = { gaining: 0, steady: 0, declining: 0 };
      for (const a of accounts) counts[a.trend]++;
      return { accounts, counts, alerts, computedAt: now.toISOString() };
    },
  );
};

// Account signals (v21): pulse (momentum), signals timeline, inferred
// initiatives and portfolio momentum. Read only, org scoped, gated by
// accounts:read plus account visibility. Contract: /workspace/fleet/polo-signals-api.md
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import {
  AccountInitiatives,
  AccountPulse,
  AccountTimeline,
  categoryForKind,
  cleanText,
  OFFERING_HOOKS,
  PortfolioMomentum,
  SignalCategory,
  stripSamplePrefix,
  themeForText,
  type Implication,
  type Initiative,
  type InitiativeTheme,
  type PortfolioAlert,
  type TimelineItem,
  collapseMarketNotes,
} from '@bidstack/shared';

import { canReadAccount } from '../lib/account-access.js';
import { applyCompanyScope, getAccessScope } from '../lib/access-scope.js';
import { visibleMeetingWhere } from '../meeting-intel/access.js';
import { closedAtOf, groupMap, loadMomentumInputs, momentumFor, OPP_SELECT, sourceStatus } from '../services/account-signals/load.js';
import { companiesWithLiveSignals, hideSampleWhere } from '../services/account-signals/live-signals.js';

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
      const m = momentumFor(loaded.get(company.id), now);
      return {
        companyId: company.id,
        companyName: company.name,
        score: m.score,
        delta: m.delta,
        trend: m.trend,
        verdict: m.verdict,
        coverage: m.coverage,
        series: m.series,
        drivers: m.drivers.slice(0, 5),
        sample: loaded.get(company.id)?.sample ?? false,
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
      const [meetings, opps, bids, events, earnings, postings] = await Promise.all([
        prisma.meetingIntel.findMany({
          where: { AND: [visibleMeetingWhere(orgId, scope), { companyId: { in: ids }, heldAt: { gte: from, lte: to } }] },
          select: { id: true, title: true, heldAt: true, summary: true, companyId: true, _count: { select: { attendees: true } } },
          orderBy: { heldAt: 'desc' },
          take: 200,
        }),
        prisma.opportunity.findMany({ where: { orgId, companyId: { in: ids }, deletedAt: null }, select: OPP_SELECT, take: 500 }),
        prisma.bidOpportunity.findMany({
          where: { orgId, deletedAt: null, buyer: { contains: escapeLike(company.name), mode: 'insensitive' }, OR: [{ importedAt: { gte: from } }, { dueDate: { gte: from } }] },
          select: { id: true, title: true, status: true, dueDate: true, importedAt: true, url: true, estimatedValueMicros: true },
          take: 100,
        }),
        prisma.accountWatchEvent.findMany({
          where: { orgId, companyId: { in: ids }, status: { not: 'DISMISSED' }, occurredAt: { gte: from, lte: to }, ...hideSampleWhere(live) },
          orderBy: { occurredAt: 'desc' },
          take: 300,
        }),
        prisma.accountEarningsDate.findMany({ where: { orgId, companyId: { in: ids }, expectedAt: { gte: from, lte: to } }, take: 20 }),
        prisma.companyJobPosting.findMany({ where: { orgId, companyId: { in: ids }, postedAt: { gte: from } }, select: { postedAt: true }, orderBy: { postedAt: 'desc' }, take: 1000 }),
      ]);
      const items: TimelineItem[] = [];
      const push = (i: Omit<TimelineItem, 'upcoming'>) => items.push({ ...i, upcoming: new Date(i.at).getTime() > now.getTime() });
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
      for (const o of opps) {
        if (o.createdAt >= from) {
          push({ id: `op:${o.id}:open`, at: o.createdAt.toISOString(), lane: 'ours', category: 'deal', title: `Deal opened: ${o.name}`, summary: `Stage ${o.stage.replace(/_/g, ' ')}`, source: 'Pipeline', sourceUrl: null, href: `/opportunities/${o.id}`, importance: 45, implication: 'NEUTRAL', sample: false });
        }
        const closed = closedAtOf(o);
        if (closed && closed >= from) {
          const won = o.stage === 'closed_won';
          push({ id: `op:${o.id}:close`, at: closed.toISOString(), lane: 'ours', category: 'deal', title: `${won ? 'Won' : 'Lost'}: ${o.name}`, summary: won ? 'Closed won' : 'Closed lost', source: 'Pipeline', sourceUrl: null, href: `/opportunities/${o.id}`, importance: won ? 70 : 60, implication: won ? 'OPPORTUNITY' : 'RISK', sample: false });
        }
      }
      for (const b of bids) {
        push({ id: `bid:${b.id}`, at: (b.dueDate ?? b.importedAt).toISOString(), lane: 'ours', category: 'bid', title: `Bid: ${b.title}`, summary: b.dueDate ? `Due ${b.dueDate.toISOString().slice(0, 10)}, ${b.status}` : b.status, source: 'Bids', sourceUrl: b.url, href: '/bid-matrix', importance: 50, implication: 'NEUTRAL', sample: false });
      }
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
      const weeks = new Map<number, number>();
      for (const p of postings) if (p.postedAt) weeks.set(Math.floor(p.postedAt.getTime() / (7 * DAY)), (weeks.get(Math.floor(p.postedAt.getTime() / (7 * DAY))) ?? 0) + 1);
      // Median over every week in the window, quiet weeks (0 postings) included.
      const totalWeeks = Math.max(weeks.size, Math.ceil(req.query.days / 7));
      const counts = [...weeks.values(), ...Array<number>(totalWeeks - weeks.size).fill(0)].sort((a, b) => a - b);
      const median = counts[Math.floor(counts.length / 2)] ?? 0;
      for (const [w, n] of weeks) {
        if (n >= 5 && n >= median * 2) {
          push({ id: `hire:${w}`, at: new Date(w * 7 * DAY + 3 * DAY).toISOString(), lane: 'theirs', category: 'hiring', title: `Hiring spike: ${n} roles posted in one week`, summary: `Typical week: ${median}`, source: 'Job postings', sourceUrl: null, href: null, importance: 55, implication: 'OPPORTUNITY', sample: false });
        }
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
      const shown = (wanted ? grouped.filter((i) => wanted.has(i.category)) : grouped).slice(0, 300);
      return { companyId: company.id, from: from.toISOString(), to: to.toISOString(), items: shown, counts: tally };
    },
  );

  server.get(
    '/accounts/:companyId/initiatives',
    { preHandler: [server.requirePermission('accounts:read')], schema: { params, response: { 200: AccountInitiatives } } },
    async (req) => {
      const { orgId, userId } = req.auth;
      const company = await readable(req, req.params.companyId);
      const scope = await getAccessScope(orgId, userId);
      const now = new Date();
      const ids = (await groupMap(orgId, [company.id])).get(company.id) ?? [company.id];
      const live = await companiesWithLiveSignals(orgId, ids);
      const [firmo, events, solutions, meetings] = await Promise.all([
        prisma.companyFirmographics.findFirst({ where: { orgId, companyId: company.id }, select: { projects: true } }),
        prisma.accountWatchEvent.findMany({
          where: {
            orgId,
            companyId: { in: ids },
            status: { not: 'DISMISSED' },
            occurredAt: { gte: new Date(now.getTime() - 365 * DAY) },
            ...hideSampleWhere(live),
            kind: { in: ['STRATEGIC_INITIATIVE', 'PRODUCT_LAUNCH', 'FUNDING_ROUND', 'PARTNERSHIP', 'M_AND_A', 'LAYOFFS', 'RESTRUCTURING', 'HIRING_SPIKE'] },
          },
          orderBy: { occurredAt: 'desc' },
          take: 100,
        }),
        prisma.accountSolution.findMany({ where: { orgId, companyId: company.id, deletedAt: null }, select: { name: true, category: true }, take: 100 }),
        prisma.meetingIntel.findMany({
          where: { AND: [visibleMeetingWhere(orgId, scope), { companyId: { in: ids }, heldAt: { gte: new Date(now.getTime() - 365 * DAY) } }] },
          select: { id: true, title: true, heldAt: true, opportunities: true, challenges: true },
          take: 100,
        }),
      ]);
      const soldThemes = new Set<InitiativeTheme>(solutions.map((s) => themeForText(`${s.category} ${s.name}`)));
      const byTheme = new Map<InitiativeTheme, Initiative>();
      const confScore = { high: 0.85, medium: 0.6, low: 0.35 } as const;
      const label = (s: number): Initiative['confidence'] => (s >= 0.75 ? 'high' : s >= 0.5 ? 'medium' : 'low');
      const make = (theme: InitiativeTheme, title: string, rationale: string, score: number, sample: boolean): Initiative => {
        const hook = OFFERING_HOOKS[theme];
        return {
          id: `init:${theme}`,
          title,
          theme,
          themeLabel: hook.label,
          rationale,
          confidence: label(score),
          confidenceScore: score,
          firstSeen: null,
          lastSeen: null,
          evidence: [],
          hook: { offering: hook.offering, pitch: hook.pitch, nextStep: hook.nextStep, alreadySold: soldThemes.has(theme) },
          sample,
        };
      };
      const seen = (it: Initiative, at: string | null) => {
        if (!at) return;
        if (!it.firstSeen || at < it.firstSeen) it.firstSeen = at;
        if (!it.lastSeen || at > it.lastSeen) it.lastSeen = at;
      };
      // 1. Hiring-based potential projects (existing reverse engineering).
      const projects = Array.isArray(firmo?.projects) ? (firmo.projects as Array<Record<string, unknown>>) : [];
      for (const p of projects) {
        const name = String(p.name ?? '');
        if (!name) continue;
        const theme = themeForText(`${String(p.kind ?? '')} ${name} ${Array.isArray(p.skills) ? p.skills.join(' ') : ''}`);
        const conf = (p.confidence === 'high' || p.confidence === 'medium' || p.confidence === 'low' ? p.confidence : 'low') as keyof typeof confScore;
        let it = byTheme.get(theme);
        if (!it) {
          it = make(theme, name, String(p.rationale ?? 'Inferred from hiring.'), confScore[conf], false);
          byTheme.set(theme, it);
        } else it.confidenceScore = Math.max(it.confidenceScore, confScore[conf]);
        const ev = Array.isArray(p.evidence) ? (p.evidence as Array<Record<string, unknown>>) : [];
        for (const e of ev.slice(0, 4)) {
          const at = typeof e.postedAt === 'string' ? e.postedAt : null;
          it.evidence.push({ kind: 'hiring', title: String(e.title ?? 'Job posting'), url: typeof e.url === 'string' ? e.url : null, at, source: String(e.source ?? 'enrichment'), sample: false });
          seen(it, at);
        }
      }
      // 2. Announcements (news, press, provider, filings).
      for (const e of events) {
        const title = cleanText(stripSamplePrefix(e.title));
        const theme = themeForText(`${title} ${e.summary}`);
        const cat = categoryForKind(e.kind, e.implication as Implication);
        let it = byTheme.get(theme);
        const imp = importanceOf(e);
        if (!it) {
          it = make(theme, title, e.implicationRationale ?? e.summary, imp >= 70 ? 0.6 : 0.4, e.sample);
          byTheme.set(theme, it);
        } else {
          it.confidenceScore = Math.min(0.95, it.confidenceScore + 0.1);
          if (!e.sample) it.sample = false;
        }
        const kind = cat === 'funding' ? 'funding' : cat === 'launch' ? 'launch' : e.source === 'sec_edgar' || e.source === 'companies_house' ? 'filing' : 'news';
        const at = e.occurredAt.toISOString();
        it.evidence.push({ kind, title, url: e.sourceUrl || null, at, source: e.source, sample: e.sample });
        seen(it, at);
      }
      // 3. What they told us in meetings (only themes already on the board).
      for (const m of meetings) {
        for (const line of [...m.opportunities, ...m.challenges].slice(0, 6)) {
          const it = byTheme.get(themeForText(line));
          if (!it) continue;
          it.confidenceScore = Math.min(0.95, it.confidenceScore + 0.1);
          const at = m.heldAt.toISOString();
          it.evidence.push({ kind: 'meeting', title: `${m.title}: ${line}`.slice(0, 200), url: null, at, source: 'Meeting intel', sample: false });
          seen(it, at);
        }
      }
      const items = [...byTheme.values()]
        .map((it) => {
          const kinds = new Set(it.evidence.map((e) => e.kind));
          const score = Math.min(0.95, it.confidenceScore + (kinds.size >= 2 ? 0.1 : 0));
          return { ...it, confidenceScore: Math.round(score * 100) / 100, confidence: label(score), evidence: it.evidence.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '')).slice(0, 8) };
        })
        .sort((a, b) => b.confidenceScore - a.confidenceScore || (b.lastSeen ?? '').localeCompare(a.lastSeen ?? ''))
        .slice(0, 8);
      return { companyId: company.id, items };
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

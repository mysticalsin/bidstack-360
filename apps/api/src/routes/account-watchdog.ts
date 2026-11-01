// Financial watchdog read model for the account page: public-filing events,
// upcoming earnings dates, past projects (closed opportunities) and a merged
// history timeline. Org-scoped and gated by account visibility.
// Design: /workspace/fleet/polo-account-breakdown-design.md §5–7.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma, type Prisma } from '@bidstack/db';
import { categoryForKind, enrichmentWatchRows, importanceScore, stripSamplePrefix } from '@bidstack/shared';

import { canReadAccount } from '../lib/account-access.js';
import { applyCompanyScope, getAccessScope } from '../lib/access-scope.js';

const Implication = z.enum(['OPPORTUNITY', 'RISK', 'NEUTRAL']);

const WatchEvent = z.object({
  id: z.string(),
  source: z.string(),
  kind: z.string(),
  title: z.string(),
  summary: z.string(),
  sourceUrl: z.string(),
  occurredAt: z.string(),
  implication: Implication,
  implicationRationale: z.string().nullable(),
  severity: z.number().int(),
  status: z.string(),
  // v21 (additive): 0..100 importance, signal category, how many outlets ran
  // the story, and whether the row is labelled sample data.
  importance: z.number().int(),
  category: z.string(),
  mentions: z.number().int(),
  sample: z.boolean(),
  displayTitle: z.string(),
});

const EarningsDate = z.object({
  id: z.string(),
  fiscalPeriod: z.string(),
  expectedAt: z.string(),
  confirmed: z.boolean(),
  source: z.string(),
  sourceUrl: z.string(),
});

const PastProject = z.object({
  id: z.string(),
  name: z.string(),
  outcome: z.enum(['won', 'lost']),
  valueMicros: z.string(),
  closedAt: z.string(),
});

const HistoryItem = z.object({
  id: z.string(),
  at: z.string(),
  type: z.enum(['filing', 'opportunity']),
  title: z.string(),
  detail: z.string(),
});

export const AccountWatchdogResponse = z.object({
  companyId: z.string(),
  monitoring: z.object({
    enabled: z.boolean(),
    identifiers: z.array(z.string()),
    lastCheckedAt: z.string().nullable(),
    lastError: z.string().nullable(),
  }),
  events: z.array(WatchEvent),
  earnings: z.array(EarningsDate),
  pastProjects: z.array(PastProject),
  history: z.array(HistoryItem),
});
export type AccountWatchdogResponse = z.infer<typeof AccountWatchdogResponse>;

// Org-wide strip for /dashboard: upcoming results in the next N days and the
// newest unreviewed signals, limited to accounts the caller can read.
export const WatchdogFeedResponse = z.object({
  days: z.number().int(),
  earnings: z.array(
    EarningsDate.extend({ companyId: z.string(), companyName: z.string() }),
  ),
  alerts: z.array(
    z.object({
      id: z.string(),
      companyId: z.string(),
      companyName: z.string(),
      title: z.string(),
      source: z.string(),
      occurredAt: z.string(),
      implication: Implication,
      importance: z.number().int(),
      category: z.string(),
      sample: z.boolean(),
    }),
  ),
  newAlertCount: z.number().int(),
  // Per-account weekly signal counts for the last HEAT_WEEKS weeks (oldest
  // first) with the worst implication seen that week: RISK > NEUTRAL > OPP.
  heat: z.array(
    z.object({
      companyId: z.string(),
      companyName: z.string(),
      weeks: z.array(z.object({ count: z.number().int(), worst: Implication.nullable() })),
    }),
  ),
  heatWeekStarts: z.array(z.string()),
});
export type WatchdogFeedResponse = z.infer<typeof WatchdogFeedResponse>;

/**
 * Potential projects from account enrichment become ordinary watch events
 * (source 'enrichment'), so they carry a status and can be dismissed. Insert
 * only: an existing row (including a dismissed one) is never touched. The
 * worker's scan does the same org-wide; this keeps the account page current
 * without waiting for the next scan.
 */
export async function syncEnrichmentWatchEvents(orgId: string, companyId: string): Promise<number> {
  const row = await prisma.companyFirmographics.findFirst({
    where: { orgId, companyId },
    select: { projects: true, fetchedAt: true },
  });
  if (!row) return 0;
  const rows = enrichmentWatchRows({ orgId, companyId, fetchedAt: row.fetchedAt, projects: row.projects });
  if (!rows.length) return 0;
  const res = await prisma.accountWatchEvent.createMany({
    skipDuplicates: true,
    data: rows.map((r) => ({
      orgId: r.orgId,
      companyId: r.companyId,
      source: r.source,
      externalId: r.externalId,
      kind: r.kind,
      occurredAt: r.occurredAt,
      title: r.title,
      sourceUrl: r.sourceUrl,
      summary: r.summary,
      implication: r.implication,
      implicationRationale: r.rationale,
      severity: r.severity,
      importance: importanceScore({ kind: r.kind, implication: r.implication, source: r.source }),
      confirmed: r.confirmed,
      payload: r.payload as unknown as Prisma.InputJsonValue,
    })),
  });
  return res.count;
}

const HEAT_WEEKS = 8;
const WEEK_MS = 7 * 86_400_000;
const WORST_RANK = { OPPORTUNITY: 1, NEUTRAL: 2, RISK: 3 } as const;

export const accountWatchdogRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/watchdog/feed',
    {
      preHandler: [server.requirePermission('accounts:read')],
      schema: {
        querystring: z.object({ days: z.coerce.number().int().min(1).max(90).default(14) }),
        response: { 200: WatchdogFeedResponse },
      },
    },
    async (req) => {
      const { orgId, userId } = req.auth;
      const { days } = req.query;
      const scope = await getAccessScope(orgId, userId);
      const companies = await prisma.company.findMany({
        where: applyCompanyScope({ orgId, deletedAt: null }, scope),
        select: { id: true, name: true },
        take: 1000,
      });
      const names = new Map(companies.map((c) => [c.id, c.name]));
      const ids = [...names.keys()];
      const now = new Date();
      const until = new Date(now.getTime() + days * 86_400_000);
      const heatFrom = new Date(now.getTime() - HEAT_WEEKS * WEEK_MS);
      const [earnings, alerts, newAlertCount, recent] = await Promise.all([
        prisma.accountEarningsDate.findMany({
          where: { orgId, companyId: { in: ids }, expectedAt: { gte: now, lte: until } },
          orderBy: { expectedAt: 'asc' },
          take: 12,
        }),
        prisma.accountWatchEvent.findMany({
          where: { orgId, companyId: { in: ids }, status: 'NEW' },
          orderBy: [{ importance: 'desc' }, { severity: 'desc' }, { occurredAt: 'desc' }],
          take: 5,
        }),
        prisma.accountWatchEvent.count({ where: { orgId, companyId: { in: ids }, status: 'NEW' } }),
        prisma.accountWatchEvent.findMany({
          where: { orgId, companyId: { in: ids }, occurredAt: { gte: heatFrom, lte: now } },
          select: { companyId: true, occurredAt: true, implication: true },
          take: 1000,
        }),
      ]);
      const heatMap = new Map<string, Array<{ count: number; worst: z.infer<typeof Implication> | null }>>();
      for (const e of recent) {
        const idx = Math.min(HEAT_WEEKS - 1, Math.floor((e.occurredAt.getTime() - heatFrom.getTime()) / WEEK_MS));
        let weeks = heatMap.get(e.companyId);
        if (!weeks) {
          weeks = Array.from({ length: HEAT_WEEKS }, () => ({ count: 0, worst: null }));
          heatMap.set(e.companyId, weeks);
        }
        const cell = weeks[idx]!;
        cell.count += 1;
        if (!cell.worst || WORST_RANK[e.implication] > WORST_RANK[cell.worst]) cell.worst = e.implication;
      }
      const heat = [...heatMap.entries()]
        .map(([companyId, weeks]) => ({ companyId, companyName: names.get(companyId) ?? '', weeks }))
        .sort((a, b) => b.weeks.reduce((n, w) => n + w.count, 0) - a.weeks.reduce((n, w) => n + w.count, 0))
        .slice(0, 8);
      return {
        days,
        earnings: earnings.map((d) => ({
          id: d.id,
          companyId: d.companyId,
          companyName: names.get(d.companyId) ?? '',
          fiscalPeriod: d.fiscalPeriod,
          expectedAt: d.expectedAt.toISOString(),
          confirmed: d.confirmed,
          source: d.source,
          sourceUrl: d.sourceUrl,
        })),
        alerts: alerts.map((e) => ({
          id: e.id,
          companyId: e.companyId,
          companyName: names.get(e.companyId) ?? '',
          title: e.title,
          source: e.source,
          occurredAt: e.occurredAt.toISOString(),
          implication: e.implication,
          importance: e.importance || e.severity * 20,
          category: categoryForKind(e.kind, e.implication),
          sample: e.sample,
        })),
        newAlertCount,
        heat,
        heatWeekStarts: Array.from({ length: HEAT_WEEKS }, (_, i) =>
          new Date(heatFrom.getTime() + i * WEEK_MS).toISOString(),
        ),
      };
    },
  );

  server.get(
    '/accounts/:companyId/watchdog',
    {
      preHandler: [server.requirePermission('accounts:read')],
      schema: {
        params: z.object({ companyId: z.string().uuid() }),
        response: { 200: AccountWatchdogResponse },
      },
    },
    async (req) => {
      const { orgId, userId } = req.auth;
      const { companyId } = req.params;
      const company = await prisma.company.findFirst({
        where: { id: companyId, orgId },
        select: { id: true, name: true },
      });
      if (!company) throw server.httpErrors.notFound('Account not found');
      const access = await canReadAccount({ orgId, userId, companyId, accountName: company.name });
      if (!access.allowed) throw server.httpErrors.notFound('Account not found');

      // Best effort: a sync failure must not hide the rest of the watchdog.
      await syncEnrichmentWatchEvents(orgId, companyId).catch((err: unknown) =>
        req.log.warn({ err: err instanceof Error ? err.message : String(err), companyId }, 'enrichment watch sync failed'),
      );
      const now = new Date();
      const [subject, events, earnings, closed] = await Promise.all([
        prisma.accountWatchSubject.findFirst({ where: { orgId, companyId } }),
        prisma.accountWatchEvent.findMany({
          where: { orgId, companyId, status: { not: 'DISMISSED' } },
          orderBy: { occurredAt: 'desc' },
          take: 50,
        }),
        prisma.accountEarningsDate.findMany({
          where: { orgId, companyId, expectedAt: { gte: now } },
          orderBy: { expectedAt: 'asc' },
          take: 8,
        }),
        prisma.opportunity.findMany({
          where: { orgId, companyId, stage: { in: ['closed_won', 'closed_lost'] } },
          select: { id: true, name: true, stage: true, valueMicros: true, updatedAt: true, closedAt: true },
          orderBy: [{ closedAt: { sort: 'desc', nulls: 'last' } }, { updatedAt: 'desc' }],
          take: 50,
        }),
      ]);

      const pastProjects = closed.map((o) => ({
        id: o.id,
        name: o.name,
        outcome: o.stage === 'closed_won' ? ('won' as const) : ('lost' as const),
        valueMicros: o.valueMicros.toString(),
        closedAt: (o.closedAt ?? o.updatedAt).toISOString(),
      }));

      const history = [
        ...events.map((e) => ({
          id: `ev:${e.id}`,
          at: e.occurredAt.toISOString(),
          type: 'filing' as const,
          title: e.title,
          detail: `${e.source} · ${e.implication.toLowerCase()}`,
        })),
        ...pastProjects.map((p) => ({
          id: `op:${p.id}`,
          at: p.closedAt,
          type: 'opportunity' as const,
          title: p.name,
          detail: p.outcome === 'won' ? 'Closed won' : 'Closed lost',
        })),
      ]
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 60);

      const identifiers = subject
        ? [
            subject.ticker && `Ticker ${subject.ticker}`,
            subject.secCik && `SEC CIK ${subject.secCik}`,
            subject.companiesHouseNumber && `Companies House ${subject.companiesHouseNumber}`,
            subject.lei && `LEI ${subject.lei}`,
          ].filter((v): v is string => Boolean(v))
        : [];

      return {
        companyId,
        monitoring: {
          enabled: Boolean(subject?.enabled && subject.identifiersConfirmedAt),
          identifiers,
          lastCheckedAt: subject?.lastCheckedAt?.toISOString() ?? null,
          lastError: subject?.lastError ?? null,
        },
        events: events.map((e) => ({
          id: e.id,
          source: e.source,
          kind: e.kind,
          title: e.title,
          summary: e.summary,
          sourceUrl: e.sourceUrl,
          occurredAt: e.occurredAt.toISOString(),
          implication: e.implication,
          implicationRationale: e.implicationRationale,
          severity: e.severity,
          status: e.status,
          importance: e.importance || e.severity * 20,
          category: categoryForKind(e.kind, e.implication),
          mentions: e.mentions,
          sample: e.sample,
          displayTitle: stripSamplePrefix(e.title),
        })),
        earnings: earnings.map((d) => ({
          id: d.id,
          fiscalPeriod: d.fiscalPeriod,
          expectedAt: d.expectedAt.toISOString(),
          confirmed: d.confirmed,
          source: d.source,
          sourceUrl: d.sourceUrl,
        })),
        pastProjects,
        history,
      };
    },
  );
  // Change a signal's status (dismiss, acknowledge, restore). Org-wide: a
  // dismissed signal is hidden for everyone who can read the account.
  server.patch(
    '/accounts/:companyId/watchdog/events/:eventId',
    {
      preHandler: [server.requirePermission('accounts:write')],
      schema: {
        params: z.object({ companyId: z.string().uuid(), eventId: z.string().uuid() }),
        body: z.object({ status: z.enum(['NEW', 'ACKNOWLEDGED', 'DISMISSED']) }),
        response: { 200: z.object({ id: z.string(), status: z.string() }) },
      },
    },
    async (req) => {
      const { orgId, userId } = req.auth;
      const { companyId, eventId } = req.params;
      const company = await prisma.company.findFirst({ where: { id: companyId, orgId }, select: { id: true, name: true } });
      if (!company) throw server.httpErrors.notFound('Account not found');
      const access = await canReadAccount({ orgId, userId, companyId, accountName: company.name });
      if (!access.allowed) throw server.httpErrors.notFound('Account not found');
      const ev = await prisma.accountWatchEvent.findFirst({ where: { id: eventId, orgId, companyId }, select: { id: true, status: true, source: true } });
      if (!ev) throw server.httpErrors.notFound('Signal not found');
      const status = req.body.status;
      if (ev.status !== status) {
        await prisma.accountWatchEvent.update({ where: { id: ev.id }, data: { status } });
        await prisma.auditLog.create({
          data: {
            orgId,
            userId,
            action: 'watchdog.event.status',
            targetType: 'account_watch_event',
            targetId: ev.id,
            diff: { companyId, source: ev.source, from: ev.status, to: status } as Prisma.InputJsonValue,
          },
        });
      }
      return { id: ev.id, status };
    },
  );
};

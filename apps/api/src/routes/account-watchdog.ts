// Financial watchdog read model for the account page: public-filing events,
// upcoming earnings dates, past projects (closed opportunities) and a merged
// history timeline. Org-scoped and gated by account visibility.
// Design: /workspace/fleet/polo-account-breakdown-design.md §5–7.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';

import { canReadAccount } from '../lib/account-access.js';

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

export const accountWatchdogRoutes: FastifyPluginAsyncZod = async (server) => {
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
          select: { id: true, name: true, stage: true, valueMicros: true, updatedAt: true },
          orderBy: { updatedAt: 'desc' },
          take: 50,
        }),
      ]);

      const pastProjects = closed.map((o) => ({
        id: o.id,
        name: o.name,
        outcome: o.stage === 'closed_won' ? ('won' as const) : ('lost' as const),
        valueMicros: o.valueMicros.toString(),
        closedAt: o.updatedAt.toISOString(),
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
};

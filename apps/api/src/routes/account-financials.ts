// v23: filed financial statements and early-warning signals for one account.
// Free public sources only (SEC EDGAR, ESEF); the worker pulls them on a
// schedule gated by tier. This route reads what was stored and lets an Admin
// or AE opt a General account in with Track financials.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import {
  AccountFinancials,
  FINANCIALS_STATUS_COPY,
  FY_PERIOD_PAGE,
  QUARTER_PERIOD_PAGE,
  FinancialSignal,
  GATE_COPY,
  SAMPLE_FINANCIAL_PERIODS,
  SAMPLE_FINANCIAL_SIGNALS,
  TrackFinancialsUpdate,
  financialsEligible,
  financialsGate,
  tierLabel,
  type FinancialPeriod,
} from '@bidstack/shared';

import { canReadAccount } from '../lib/account-access.js';
import { userHasAnyRole, userHasPermission } from '../lib/rbac-decision-cache.js';
import { syncAccountFinancialsSchedule } from '../services/account-financials/schedule.js';

/** Who may opt a General account in or out. */
export const TRACK_FINANCIALS_ROLES = ['Admin', 'Account Executive'];

const SOURCE_NAME: Record<string, string> = { sec_edgar: 'SEC EDGAR', esef: 'ESEF (filings.xbrl.org)' };

async function canToggle(orgId: string, userId: string, role: string): Promise<boolean> {
  if (role === 'api') return false;
  return (await userHasPermission(orgId, userId, 'accounts:write')) && (await userHasAnyRole(orgId, userId, TRACK_FINANCIALS_ROLES));
}

export async function loadAccountFinancials(orgId: string, companyId: string, toggle: boolean): Promise<AccountFinancials> {
  const c = await prisma.company.findFirst({
    where: { id: companyId, orgId, deletedAt: null },
    select: {
      id: true,
      tier: true,
      topAccountRank: true,
      trackFinancials: true,
      financialProfile: true,
    },
  });
  if (!c) throw Object.assign(new Error('Account not found'), { statusCode: 404 });
  const periodWhere = { orgId, companyId };
  const [fyRows, quarterRows] = await Promise.all([
    prisma.accountFinancialPeriod.findMany({
      where: { ...periodWhere, periodType: 'FY' },
      orderBy: [{ periodEnd: 'desc' }, { id: 'asc' }],
      take: FY_PERIOD_PAGE,
    }),
    prisma.accountFinancialPeriod.findMany({
      where: { ...periodWhere, periodType: 'Q' },
      orderBy: [{ periodEnd: 'desc' }, { id: 'asc' }],
      take: QUARTER_PERIOD_PAGE,
    }),
  ]);
  const fyCount = fyRows.length === FY_PERIOD_PAGE
    ? await prisma.accountFinancialPeriod.count({ where: { ...periodWhere, periodType: 'FY' } })
    : fyRows.length;
  const periodsCapped = fyCount > FY_PERIOD_PAGE;
  const gate = financialsGate(c);
  const p = c.financialProfile;
  const status = !financialsEligible(c) ? 'paused' : (p?.status ?? 'pending');
  const periods: FinancialPeriod[] = [...fyRows, ...quarterRows].map((r) => {
    const { _derived, ...metrics } = r.metrics as Record<string, { value: number; concept: string }> & { _derived?: FinancialPeriod['derived'] };
    return {
      periodType: r.periodType === 'Q' ? 'Q' : 'FY',
      fiscalYear: r.fiscalYear,
      periodStart: r.periodStart ? r.periodStart.toISOString().slice(0, 10) : null,
      periodEnd: r.periodEnd.toISOString().slice(0, 10),
      currency: r.currency,
      source: SOURCE_NAME[r.source] ?? r.source,
      sourceUrl: r.sourceUrl,
      filedAt: r.filedAt ? r.filedAt.toISOString() : null,
      metrics,
      derived: { operatingMargin: _derived?.operatingMargin ?? null, netMargin: _derived?.netMargin ?? null, freeCashFlow: _derived?.freeCashFlow ?? null },
    };
  });
  const signals = z.array(FinancialSignal).catch([]).parse(p?.signals ?? []);
  // Sample only for tracked accounts still waiting for real filings; General
  // accounts get the plain empty state instead.
  const sample = periods.length === 0 && financialsEligible(c);
  return {
    companyId: c.id,
    tier: c.tier,
    tierLabel: tierLabel(c.tier),
    gate,
    gateCopy: GATE_COPY[gate],
    trackFinancials: c.trackFinancials,
    canToggle: toggle,
    status,
    statusCopy: status === 'ok' ? null : (FINANCIALS_STATUS_COPY[status] ?? null),
    entity: p?.source && p.entityId ? { source: SOURCE_NAME[p.source] ?? p.source, id: p.entityId, name: p.entityName ?? '' } : null,
    lastPulledAt: p?.lastPulledAt ? p.lastPulledAt.toISOString() : null,
    nextPullAt: p?.nextPullAt && financialsEligible(c) ? p.nextPullAt.toISOString() : null,
    periods: sample ? SAMPLE_FINANCIAL_PERIODS : periods,
    periodsCapped: sample ? false : periodsCapped,
    signals: sample ? SAMPLE_FINANCIAL_SIGNALS : signals,
    sample,
  };
}

export const accountFinancialsRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/accounts/:companyId/financials',
    {
      preHandler: [server.requirePermission('accounts:read')],
      schema: { params: z.object({ companyId: z.string().uuid() }), response: { 200: AccountFinancials } },
    },
    async (req) => {
      const { orgId, userId, role } = req.auth;
      const { companyId } = req.params;
      const company = await prisma.company.findFirst({ where: { id: companyId, orgId, deletedAt: null }, select: { name: true } });
      if (!company) throw server.httpErrors.notFound('Account not found');
      const access = await canReadAccount({ orgId, userId, companyId, accountName: company.name });
      if (!access.allowed) throw server.httpErrors.notFound('Account not found');
      return loadAccountFinancials(orgId, companyId, await canToggle(orgId, userId, role));
    },
  );

  server.patch(
    '/accounts/:companyId/financials/track',
    {
      preHandler: [server.requirePermission('accounts:write'), server.requireRole(...TRACK_FINANCIALS_ROLES)],
      schema: { params: z.object({ companyId: z.string().uuid() }), body: TrackFinancialsUpdate, response: { 200: AccountFinancials } },
    },
    async (req) => {
      const { orgId, userId } = req.auth;
      const { companyId } = req.params;
      const company = await prisma.company.findFirst({ where: { id: companyId, orgId, deletedAt: null }, select: { name: true, trackFinancials: true } });
      if (!company) throw server.httpErrors.notFound('Account not found');
      const access = await canReadAccount({ orgId, userId, companyId, accountName: company.name });
      if (!access.allowed) throw server.httpErrors.notFound('Account not found');
      if (company.trackFinancials !== req.body.trackFinancials) {
        await prisma.company.update({ where: { id: companyId }, data: { trackFinancials: req.body.trackFinancials } });
        await prisma.auditLog.create({
          data: {
            orgId,
            userId,
            action: 'company.update',
            targetType: 'company',
            targetId: companyId,
            diff: { actorKind: 'user', changedFields: ['trackFinancials'], changes: { trackFinancials: { from: company.trackFinancials, to: req.body.trackFinancials } } },
          },
        });
      }
      await syncAccountFinancialsSchedule(orgId, companyId);
      return loadAccountFinancials(orgId, companyId, true);
    },
  );
};

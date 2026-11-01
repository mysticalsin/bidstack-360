import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

// v23: financials read model, Track financials toggle and tier gating.

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let restoreAuth: (() => void) | null = null;
let previousStubRoleHeader: string | undefined;

beforeAll(async () => {
  previousStubRoleHeader = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    return;
  }
  const org = await createIsolatedOrg('financials');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (server) await server.close();
  if (restoreAuth) restoreAuth();
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
  if (previousStubRoleHeader === undefined) delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  else process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previousStubRoleHeader;
});

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!orgId);
const mk = (name: string, tier: 'key' | 'top' | 'standard') => prisma.company.create({ data: { orgId: orgId!, name: `${name} ${Date.now()}`, tier } });

describe('account financials', () => {
  skipIfNoDb('General account: empty state, no sample, not scheduled', async () => {
    const c = await mk('General Co', 'standard');
    const body = (await server.inject({ method: 'GET', url: `/api/v1/accounts/${c.id}/financials` })).json();
    expect(body).toMatchObject({ tierLabel: 'General', gate: 'general', status: 'paused', sample: false, periods: [], signals: [], canToggle: true, trackFinancials: false });
    expect(body.gateCopy).toMatch(/not pulled automatically/);
    expect(body.gateCopy).not.toContain('\u2014');
    expect(await prisma.accountFinancialProfile.count({ where: { companyId: c.id } })).toBe(0);
  });

  skipIfNoDb('Strategic account with no filings yet shows the labeled sample', async () => {
    const c = await mk('Strategic Co', 'key');
    const body = (await server.inject({ method: 'GET', url: `/api/v1/accounts/${c.id}/financials` })).json();
    expect(body).toMatchObject({ tierLabel: 'Strategic', gate: 'tier', sample: true });
    expect(body.periods.length).toBeGreaterThan(0);
    expect(body.periods.every((p: { source: string }) => p.source === 'sample')).toBe(true);
    expect(body.signals.every((s: { sample: boolean; title: string }) => s.sample && s.title.startsWith('Sample:'))).toBe(true);
  });

  skipIfNoDb('stored periods come back with source, period and derived margin; no sample mixed in', async () => {
    const c = await mk('Filed Co', 'top');
    await prisma.accountFinancialProfile.create({
      data: {
        orgId: orgId!, companyId: c.id, source: 'esef', entityId: '5493004DM8FGIY6QKF37', entityName: 'FILED CO SA', status: 'ok', lastPulledAt: new Date(), nextPullAt: new Date(Date.now() + 86_400_000),
        signals: [{ id: 'margin_squeeze:2025-12-31', rule: 'margin_squeeze', title: 'Operating margin down 5.9 pts', explanation: 'Margin fell.', confidence: 'high', implication: 'RISK', periodEnd: '2025-12-31', sourceUrl: 'https://filings.xbrl.org/x', snippet: null, sample: false }],
      },
    });
    await prisma.accountFinancialPeriod.create({
      data: {
        orgId: orgId!, companyId: c.id, source: 'esef', entityId: '5493004DM8FGIY6QKF37', periodType: 'FY', fiscalYear: 2025, periodStart: new Date('2025-01-01'), periodEnd: new Date('2025-12-31'), currency: 'EUR', sourceUrl: 'https://filings.xbrl.org/x', filedAt: new Date('2026-03-20'),
        metrics: { revenue: { value: 1823e6, concept: 'ifrs-full:Revenue' }, operatingIncome: { value: 301e6, concept: 'ifrs-full:ProfitLossFromOperatingActivities' }, _derived: { operatingMargin: 16.5, netMargin: null, freeCashFlow: null } },
      },
    });
    const body = (await server.inject({ method: 'GET', url: `/api/v1/accounts/${c.id}/financials` })).json();
    expect(body.sample).toBe(false);
    expect(body.status).toBe('ok');
    expect(body.entity).toEqual({ source: 'ESEF (filings.xbrl.org)', id: '5493004DM8FGIY6QKF37', name: 'FILED CO SA' });
    expect(body.periods[0]).toMatchObject({ periodEnd: '2025-12-31', currency: 'EUR', source: 'ESEF (filings.xbrl.org)', sourceUrl: 'https://filings.xbrl.org/x', derived: { operatingMargin: 16.5 } });
    expect(body.periods[0].metrics._derived).toBeUndefined();
    expect(body.signals[0].title).toBe('Operating margin down 5.9 pts');
  });

  skipIfNoDb('Track financials: AE opts a General account in and out; schedule follows', async () => {
    const c = await mk('Optin Co', 'standard');
    const on = await server.inject({ method: 'PATCH', url: `/api/v1/accounts/${c.id}/financials/track`, headers: { 'x-bidstack-e2e-role': 'account-executive' }, payload: { trackFinancials: true } });
    expect(on.statusCode).toBe(200);
    expect(on.json()).toMatchObject({ gate: 'opt_in', trackFinancials: true, status: 'pending', sample: true });
    expect(await prisma.accountFinancialProfile.findUnique({ where: { companyId: c.id } })).toMatchObject({ status: 'pending' });
    const off = await server.inject({ method: 'PATCH', url: `/api/v1/accounts/${c.id}/financials/track`, headers: { 'x-bidstack-e2e-role': 'account-executive' }, payload: { trackFinancials: false } });
    expect(off.json()).toMatchObject({ gate: 'general', status: 'paused', sample: false });
    expect(await prisma.accountFinancialProfile.findUnique({ where: { companyId: c.id } })).toMatchObject({ status: 'paused', nextPullAt: null });
  });

  skipIfNoDb('Track financials is refused for SDR and read-only users, and canToggle says so', async () => {
    const c = await mk('Locked Co', 'standard');
    for (const role of ['sdr', 'read-only']) {
      const res = await server.inject({ method: 'PATCH', url: `/api/v1/accounts/${c.id}/financials/track`, headers: { 'x-bidstack-e2e-role': role }, payload: { trackFinancials: true } });
      expect(res.statusCode).toBe(403);
    }
    const get = (await server.inject({ method: 'GET', url: `/api/v1/accounts/${c.id}/financials`, headers: { 'x-bidstack-e2e-role': 'sdr' } })).json();
    expect(get.canToggle).toBe(false);
    expect((await prisma.company.findUnique({ where: { id: c.id } }))?.trackFinancials).toBe(false);
  });

  skipIfNoDb('a tier change on the company starts or stops the schedule', async () => {
    const c = await mk('Tier Co', 'standard');
    const up = await server.inject({ method: 'PATCH', url: `/api/v1/companies/${c.id}`, payload: { tier: 'top' } });
    expect(up.statusCode).toBe(200);
    expect(await prisma.accountFinancialProfile.findUnique({ where: { companyId: c.id } })).toMatchObject({ status: 'pending' });
    await server.inject({ method: 'PATCH', url: `/api/v1/companies/${c.id}`, payload: { tier: 'standard' } });
    expect(await prisma.accountFinancialProfile.findUnique({ where: { companyId: c.id } })).toMatchObject({ status: 'paused', nextPullAt: null });
  });

  skipIfNoDb('another org cannot read an account', async () => {
    const other = await prisma.org.create({ data: { clerkOrg: `org_fin_other_${Date.now()}`, name: 'Financials other' } });
    const c = await prisma.company.create({ data: { orgId: other.id, name: 'Hidden Co', tier: 'key' } });
    const res = await server.inject({ method: 'GET', url: `/api/v1/accounts/${c.id}/financials` });
    expect(res.statusCode).toBe(404);
    await dropIsolatedOrg(other.id);
  });
});

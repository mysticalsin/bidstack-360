import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

// Task 5: the account watchdog read model. Monitoring status is honest
// (enabled only once identifiers are confirmed; lastError surfaced), events
// are newest-first with dismissed ones hidden, earnings are future-only, and
// another org's account is invisible.

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let otherOrgId: string | null = null;
let restoreAuth: (() => void) | null = null;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    return;
  }
  const org = await createIsolatedOrg('watchdog');
  orgId = org.orgId;
  otherOrgId = (await prisma.org.create({ data: { clerkOrg: `org_wd_other_${org.namespace}`, name: 'Watchdog other org' } })).id;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (server) await server.close();
  if (restoreAuth) restoreAuth();
  if (orgId) await dropIsolatedOrg(orgId);
  if (otherOrgId) await dropIsolatedOrg(otherOrgId);
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!orgId);

const ev = (o: string, c: string, externalId: string, occurredAt: string, extra: Record<string, unknown> = {}) => ({
  orgId: o,
  companyId: c,
  source: 'companies_house',
  externalId,
  kind: 'FILING' as const,
  occurredAt: new Date(occurredAt),
  title: `Filing ${externalId}`,
  sourceUrl: `https://find-and-update.company-information.service.gov.uk/company/00123456/filing-history/${externalId}`,
  summary: 'Test filing.',
  implication: 'NEUTRAL' as const,
  severity: 2,
  confirmed: true,
  payload: {},
  ...extra,
});

describe('GET /accounts/:companyId/watchdog', () => {
  skipIfNoDb('reports honest monitoring status, newest-first events, future earnings and the merged history', async () => {
    const company = await prisma.company.create({ data: { orgId: orgId!, name: `Watch Co ${Date.now()}` } });
    // Unconfirmed identifiers: not reported as monitoring.
    const subject = await prisma.accountWatchSubject.create({
      data: { orgId: orgId!, companyId: company.id, companiesHouseNumber: '00123456', ticker: 'WTC', enabled: true },
    });
    let res = await server.inject({ method: 'GET', url: `/api/v1/accounts/${company.id}/watchdog` });
    expect(res.statusCode).toBe(200);
    expect(res.json().monitoring).toEqual({
      enabled: false,
      identifiers: ['Ticker WTC', 'Companies House 00123456'],
      lastCheckedAt: null,
      lastError: null,
    });

    const checked = new Date('2026-10-31T09:00:00.000Z');
    await prisma.accountWatchSubject.update({
      where: { id: subject.id },
      data: { identifiersConfirmedAt: new Date(), lastCheckedAt: checked, lastError: 'Companies House rate limited (429)' },
    });
    await prisma.accountWatchEvent.createMany({
      data: [
        ev(orgId!, company.id, 'OLD', '2026-08-01T00:00:00Z'),
        ev(orgId!, company.id, 'NEWEST', '2026-10-20T00:00:00Z', { kind: 'INSOLVENCY', implication: 'RISK', severity: 5, implicationRationale: 'Insolvency filing.' }),
        ev(orgId!, company.id, 'MID', '2026-09-30T00:00:00Z'),
        ev(orgId!, company.id, 'HIDDEN', '2026-10-25T00:00:00Z', { status: 'DISMISSED' }),
      ],
    });
    const future = new Date(Date.now() + 10 * 86_400_000);
    await prisma.accountEarningsDate.createMany({
      data: [
        { orgId: orgId!, companyId: company.id, fiscalPeriod: 'FY2026-Q4', expectedAt: future, source: 'edgar', sourceUrl: 'https://www.sec.gov/' },
        { orgId: orgId!, companyId: company.id, fiscalPeriod: 'FY2026-Q2', expectedAt: new Date('2026-01-10T00:00:00Z'), source: 'edgar', sourceUrl: 'https://www.sec.gov/' },
      ],
    });
    const opp = await prisma.opportunity.create({
      data: { orgId: orgId!, code: `WD-${Date.now() % 100000}`, customer: company.name, companyId: company.id, name: 'Past bid', stage: 'closed_won', closedAt: new Date('2026-09-01T00:00:00Z') },
    });

    res = await server.inject({ method: 'GET', url: `/api/v1/accounts/${company.id}/watchdog` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.monitoring).toMatchObject({ enabled: true, lastCheckedAt: checked.toISOString(), lastError: 'Companies House rate limited (429)' });
    expect(body.events.map((e: { title: string }) => e.title)).toEqual(['Filing NEWEST', 'Filing MID', 'Filing OLD']);
    expect(body.events[0]).toMatchObject({ implication: 'RISK', severity: 5, implicationRationale: 'Insolvency filing.', status: 'NEW' });
    expect(body.earnings.map((d: { fiscalPeriod: string }) => d.fiscalPeriod)).toEqual(['FY2026-Q4']);
    expect(body.pastProjects).toEqual([expect.objectContaining({ id: opp.id, outcome: 'won', closedAt: '2026-09-01T00:00:00.000Z' })]);
    expect(body.history.map((h: { id: string }) => h.id)).toEqual(
      expect.arrayContaining([`op:${opp.id}`]),
    );
    const ats = body.history.map((h: { at: string }) => h.at);
    expect([...ats].sort().reverse()).toEqual(ats);
  });

  skipIfNoDb("returns 404 for another org's account and its events never leak into the feed", async () => {
    const foreign = await prisma.company.create({ data: { orgId: otherOrgId!, name: 'Foreign Co' } });
    await prisma.accountWatchEvent.create({ data: ev(otherOrgId!, foreign.id, 'FOREIGN', '2026-10-30T00:00:00Z', { implication: 'RISK', severity: 5 }) });
    const res = await server.inject({ method: 'GET', url: `/api/v1/accounts/${foreign.id}/watchdog` });
    expect(res.statusCode).toBe(404);
    const feed = await server.inject({ method: 'GET', url: '/api/v1/watchdog/feed?days=30' });
    expect(feed.statusCode).toBe(200);
    expect(JSON.stringify(feed.json())).not.toContain('Filing FOREIGN');
  });

  skipIfNoDb('the feed counts NEW alerts for readable accounts, worst first', async () => {
    const feed = await server.inject({ method: 'GET', url: '/api/v1/watchdog/feed?days=30' });
    const body = feed.json();
    expect(body.newAlertCount).toBeGreaterThanOrEqual(3);
    expect(body.alerts[0]).toMatchObject({ title: 'Filing NEWEST', implication: 'RISK' });
    expect(body.earnings.map((d: { fiscalPeriod: string }) => d.fiscalPeriod)).toContain('FY2026-Q4');
  });
});

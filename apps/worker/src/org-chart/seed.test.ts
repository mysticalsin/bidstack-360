// Org chart seed: CEO root, reports-to and inferred placement, meeting
// attendees, Apollo behind the budget guard, idempotency, and existing
// nodes left untouched.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';
import type { OrgChartSeedJob } from '@bidstack/shared';

import type { EnrichmentProvider, PeopleSearchResult } from '../account-enrichment/providers.js';
import { inferParent, runOrgChartSeed } from './seed.js';

const stamp = Date.now();
const NOW = new Date('2026-10-31T15:00:00Z');
let orgId = '';
let acme = '';
let acmeFr = '';
let empty = '';
let manual = '';
const p: Record<string, string> = {};

function apollo(result: Partial<PeopleSearchResult>, configured = true): EnrichmentProvider & { searches: number } {
  const prov = {
    id: 'apollo' as const,
    searches: 0,
    configured: () => configured,
    enrich: async () => {
      throw new Error('enrich must not run during a seed');
    },
    searchPeople: async (_i: unknown, ctx: { reserve: (op: string, c: number) => Promise<boolean> }) => {
      prov.searches++;
      if (!(await ctx.reserve('mixed_people.api_search', 0))) return { provider: 'apollo' as const, status: 'budget_exceeded' as const, people: [], creditsUsed: 0 };
      return { provider: 'apollo' as const, status: 'ok' as const, people: [], creditsUsed: 0, ...result };
    },
  };
  return prov;
}
const deps = (providers: EnrichmentProvider[], budget = 100) => ({
  providers,
  config: { ttlDays: 7, monthlyBudget: { apollo: budget, seamless: 100 }, maxJobPages: 0 },
  now: () => NOW,
});
const job = (companyId: string, over: Partial<OrgChartSeedJob> = {}): OrgChartSeedJob => ({
  kind: 'orgchart_seed',
  orgId,
  companyId,
  requestedById: null,
  includeApollo: false,
  includeMeetingAttendees: true,
  ...over,
});
const nodes = (companyId: string) =>
  prisma.orgChartNode.findMany({ where: { orgId, chart: { companyId }, deletedAt: null }, orderBy: { createdAt: 'asc' }, take: 100 });

beforeAll(async () => {
  orgId = (await prisma.org.create({ data: { name: 'OC seed', clerkOrg: `org_ocseed_${stamp}` } })).id;
  acme = (await prisma.company.create({ data: { orgId, name: 'Acme Group', domain: 'acme.test' } })).id;
  acmeFr = (await prisma.company.create({ data: { orgId, name: 'Acme France', parentId: acme } })).id;
  empty = (await prisma.company.create({ data: { orgId, name: 'Nobody Inc', domain: 'nobody.test' } })).id;
  manual = (await prisma.company.create({ data: { orgId, name: 'Hand built' } })).id;
  const person = async (k: string, name: string, role: string, companyId = acme, extra: Record<string, unknown> = {}) =>
    (p[k] = (await prisma.contact.create({ data: { orgId, customer: 'Acme', companyId, name, role, ...extra } })).id);
  await person('ceo', 'Ada Ceo', 'Chief Executive Officer');
  await person('cfo', 'Carl Cfo', 'CFO', acmeFr, { reportsToContactId: p.ceo });
  await person('vpEng', 'Vera Eng', 'VP Engineering');
  await person('dev', 'Dan Dev', 'Software Engineer');
  await person('ctrl', 'Cora Controller', 'Financial Controller', acme, { reportsToContactId: p.cfo });
  await prisma.meetingIntel.create({
    data: {
      orgId,
      companyId: acmeFr,
      title: 'QBR',
      heldAt: NOW,
      dedupeKey: `ocseed-${stamp}`.padEnd(20, 'x'),
      sources: { create: [{ orgId, source: 'metis', externalId: `ocseed-${stamp}` }] },
      attendees: {
        create: [
          { orgId, name: 'Paula Proc', email: 'paula@acme.test', title: 'Director of Procurement', seniority: 'director' },
          { orgId, name: 'Ada Ceo', contactId: p.ceo, title: 'CEO', seniority: 'c_level' },
          { orgId, name: 'Our AE', isInternal: true },
        ],
      },
    },
  });
});

afterAll(async () => {
  if (orgId) {
    await prisma.enrichmentCreditUsage.deleteMany({ where: { orgId } });
    await prisma.org.delete({ where: { id: orgId } }).catch(() => undefined);
  }
});

describe('inferParent', () => {
  it('picks the closest more senior node in the same function, else the root', () => {
    const placed = [
      { id: 'root', seniority: 'c_level' as const, function: null },
      { id: 'cto', seniority: 'c_level' as const, function: 'engineering' },
      { id: 'vp', seniority: 'vp' as const, function: 'engineering' },
      { id: 'peer', seniority: 'manager' as const, function: 'engineering' },
    ];
    expect(inferParent({ seniority: 'manager', function: 'engineering' }, placed, 'root')).toBe('vp');
    expect(inferParent({ seniority: 'vp', function: 'engineering' }, placed, 'root')).toBe('cto');
    expect(inferParent({ seniority: 'manager', function: 'sales' }, placed, 'root')).toBe('root');
    expect(inferParent({ seniority: 'ic', function: null }, placed, 'root')).toBe('root');
  });
});

describe('runOrgChartSeed', () => {
  it('roots the chart at the CEO and places reports by facts, then by function', async () => {
    const res = await runOrgChartSeed(job(acme), deps([]));
    expect(res).toMatchObject({ status: 'ok', created: 6, root: 'candidate', apollo: 'skipped', chartVersion: 2 });
    const list = await nodes(acme);
    const by = (contactId: string) => list.find((n) => n.contactId === contactId)!;
    const root = list.find((n) => n.parentId === null)!;
    expect(root).toMatchObject({ contactId: p.ceo, placement: 'root', source: 'contacts' });
    expect(by(p.cfo!)).toMatchObject({ parentId: root.id, placement: 'reports_to' });
    expect(by(p.ctrl!)).toMatchObject({ parentId: by(p.cfo!).id, placement: 'reports_to' });
    expect(by(p.dev!)).toMatchObject({ parentId: by(p.vpEng!).id, placement: 'inferred' });
    const paula = list.find((n) => n.name === 'Paula Proc')!;
    expect(paula).toMatchObject({ kind: 'placeholder', source: 'metis', externalRef: 'paula@acme.test', seniority: 'director', parentId: root.id });
    expect(list.filter((n) => n.name === 'Ada Ceo')).toHaveLength(1);
    const audit = await prisma.auditLog.findFirst({ where: { orgId, action: 'orgchart.seed', targetId: acme } });
    expect(audit?.diff).toMatchObject({ created: 6, root: 'candidate' });
  });

  it('is idempotent and never changes existing nodes', async () => {
    const before = await nodes(acme);
    const cfo = before.find((n) => n.contactId === p.cfo)!;
    await prisma.orgChartNode.update({ where: { id: cfo.id }, data: { title: 'Edited by admin', parentId: before.find((n) => n.contactId === p.vpEng)!.id } });
    const res = await runOrgChartSeed(job(acme), deps([]));
    expect(res).toMatchObject({ created: 0, skipped: 6, root: 'existing', chartVersion: 2 });
    const after = await prisma.orgChartNode.findUniqueOrThrow({ where: { id: cfo.id } });
    expect(after.title).toBe('Edited by admin');
    expect(after.version).toBe(cfo.version);
    const late = await prisma.contact.create({ data: { orgId, customer: 'Acme', companyId: acme, name: 'Lena Late', role: 'Engineering Manager' } });
    const again = await runOrgChartSeed(job(acme), deps([]));
    expect(again.created).toBe(1);
    const lena = (await nodes(acme)).find((n) => n.contactId === late.id)!;
    expect(lena.parentId).toBe(before.find((n) => n.contactId === p.vpEng)!.id);
  });

  it('adds Apollo people under the budget guard and only when asked', async () => {
    const prov = apollo({ people: [{ externalId: 'ap-9', name: 'Olga Op***s', title: 'Chief Operating Officer', refreshedAt: null }, { externalId: 'ap-1', name: 'Ada Ce***o', title: 'Chief Executive Officer', refreshedAt: null }] });
    await runOrgChartSeed(job(acme), deps([prov]));
    expect(prov.searches).toBe(0);
    const res = await runOrgChartSeed(job(acme, { includeApollo: true }), deps([prov]));
    expect(res).toMatchObject({ apollo: 'ok', created: 1 });
    const olga = (await nodes(acme)).find((n) => n.externalRef === 'ap-9')!;
    expect(olga).toMatchObject({ source: 'apollo', kind: 'placeholder', seniority: 'c_level' });
    const ledger = await prisma.enrichmentCreditUsage.findMany({ where: { orgId, operation: 'mixed_people.api_search' }, take: 10 });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.credits).toBe(0);
    expect((await runOrgChartSeed(job(acme, { includeApollo: true }), deps([prov]))).created).toBe(0);

    await prisma.enrichmentCreditUsage.create({ data: { orgId, provider: 'apollo', operation: 'organizations.enrich', credits: 5, companyId: acme, at: NOW } });
    const searches = prov.searches;
    const over = await runOrgChartSeed(job(acme, { includeApollo: true }), deps([prov], 5));
    expect(over.apollo).toBe('budget_exceeded');
    expect(prov.searches).toBe(searches);
    expect((await runOrgChartSeed(job(acme, { includeApollo: true }), deps([apollo({}, false)]))).apollo).toBe('not_configured');
  });

  it('creates a CEO placeholder when nobody looks like the CEO', async () => {
    await prisma.contact.create({ data: { orgId, customer: 'N', companyId: empty, name: 'Sam Sales', role: 'Sales Director' } });
    const res = await runOrgChartSeed(job(empty), deps([]));
    expect(res).toMatchObject({ created: 2, root: 'placeholder' });
    const list = await nodes(empty);
    const root = list.find((n) => n.parentId === null)!;
    expect(root).toMatchObject({ name: 'Chief Executive Officer', kind: 'placeholder', source: 'seed', seniority: 'c_level' });
    expect(list.find((n) => n.name === 'Sam Sales')!.parentId).toBe(root.id);
  });

  it('keeps a hand-built root and reports missing companies', async () => {
    const chart = await prisma.orgChart.create({ data: { orgId, companyId: manual } });
    const root = await prisma.orgChartNode.create({ data: { orgId, chartId: chart.id, name: 'Manual Boss', placement: 'root' } });
    await prisma.contact.create({ data: { orgId, customer: 'M', companyId: manual, name: 'Chris Chief', role: 'CEO' } });
    const res = await runOrgChartSeed(job(manual), deps([]));
    expect(res).toMatchObject({ created: 1, root: 'existing' });
    expect((await nodes(manual)).find((n) => n.name === 'Chris Chief')!.parentId).toBe(root.id);
    expect((await runOrgChartSeed(job('00000000-0000-4000-8000-000000000000'), deps([]))).status).toBe('not_found');
  });
});

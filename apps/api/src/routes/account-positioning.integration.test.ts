// v24 account positioning and key numbers.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { prisma } from '@bidstack/db';
import type { AccountKeyNumbers, AccountPositioning } from '@bidstack/shared';

import { invalidateAccessScope } from '../lib/access-scope.js';
import { buildServer } from '../server.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../test-support/isolated-org.js';

const TAG = `pos${Date.now()}`;
const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY);
let server: FastifyInstance;
let orgA = { orgId: '', clerkOrg: '' };
let orgB = { orgId: '', clerkOrg: '' };
let restoreAuth: (() => void) | null = null;
const c: Record<string, string> = {};

beforeAll(async () => {
  orgA = await createIsolatedOrg('pos-a');
  orgB = await createIsolatedOrg('pos-b');
  restoreAuth = useIsolatedOrgAuth(orgA.clerkOrg);
  const o = orgA.orgId;
  c.acme = (await prisma.company.create({ data: { orgId: o, name: `${TAG} Acme`, countryCode: 'BR', industry: 'Retail', employeeCount: 1200 } })).id;
  c.empty = (await prisma.company.create({ data: { orgId: o, name: `${TAG} Empty` } })).id;
  c.other = (await prisma.company.create({ data: { orgId: orgB.orgId, name: `${TAG} Other` } })).id;
  const opp = (code: string, name: string, stage: string, value: bigint, companyId: string, created = ago(200), closedAt: Date | null = null) =>
    prisma.opportunity.create({ data: { orgId: o, code: `${TAG}-${code}`, customer: `${TAG} Acme`, name, stage: stage as never, valueMicros: value, companyId, createdAt: created, closedAt } });
  await opp('open', 'Data platform phase 2', 's2_sent', 3_000_000_000_000n, c.acme!, ago(40));
  for (const [i, v] of [1n, 2n, 3n, 4n].entries()) await opp(`w${i}`, `Data analytics platform ${i}`, 'closed_won', v * 1_000_000_000_000n, c.empty!, ago(300), ago(100));
  const cio = await prisma.contact.create({ data: { orgId: o, companyId: c.acme!, customer: `${TAG} Acme`, name: 'Rita Gomes', role: 'Chief Data Officer' } });
  await prisma.contact.create({ data: { orgId: o, companyId: c.acme!, customer: `${TAG} Acme`, name: 'Paulo Lima', role: 'Analyst' } });
  await prisma.meetingIntel.create({
    data: {
      orgId: o,
      companyId: c.acme!,
      title: `${TAG} Data review`,
      heldAt: ago(12),
      visibility: 'org',
      dedupeKey: `${TAG}-review`.padEnd(20, 'x'),
      opportunities: ['Data platform consolidation'],
      challenges: [],
      attendees: { create: [{ orgId: o, contactId: cio.id, name: 'Rita Gomes', title: 'Chief Data Officer', seniority: 'c_level', isInternal: false }] },
    },
  });
  for (let i = 0; i < 5; i++) {
    await prisma.companyJobPosting.create({
      data: { orgId: o, companyId: c.acme!, source: 'apollo', externalId: `${TAG}-j${i}`, title: `Data Engineer ${i}`, region: 'EMEA', function: 'data', seniority: 'mid', skills: [], fetchedAt: new Date(), postedAt: ago(i < 4 ? 5 : 120), lastSeenAt: ago(2) },
    });
  }
  await prisma.companyFirmographics.create({
    data: {
      orgId: o,
      companyId: c.acme!,
      status: 'ok',
      employeeCount: 1500,
      headcountGrowth12m: 0.12,
      locations: [],
      providerIds: {},
      provenance: {},
      providerStatus: {},
      fetchedAt: new Date(),
      projects: [
        { id: 'data_platform:EMEA', kind: 'data_platform', name: 'Data platform build-out', rationale: 'Data engineering roles.', confidence: 'medium', region: 'EMEA', postingCount: 4, seniorCount: 0, skills: ['spark'], evidence: [{ postingId: 'p1', title: 'Data Engineer', url: 'https://jobs.example/1', postedAt: ago(5).toISOString(), source: 'apollo' }], method: 'rules' },
      ],
    },
  });
  const ev = (externalId: string, kind: string, title: string, days: number, extra: Record<string, unknown> = {}) =>
    prisma.accountWatchEvent.create({
      data: { orgId: o, companyId: c.acme!, source: 'gdelt', externalId: `${TAG}-${externalId}`, kind: kind as never, occurredAt: ago(days), title, sourceUrl: `https://news.example/${externalId}`, summary: title, implication: 'NEUTRAL', severity: 3, ...extra },
    });
  await ev('restr', 'RESTRUCTURING', 'Acme announces store restructuring', 20, { importance: 80, sentiment: -0.6 });
  await ev('good', 'NEWS_SIGNAL', 'Acme wins retail award', 30, { importance: 40, sentiment: 0.4 });
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  await server?.close();
  restoreAuth?.();
  for (const org of [orgA, orgB]) {
    invalidateAccessScope(org.orgId);
    if (org.orgId) await dropIsolatedOrg(org.orgId);
  }
});

const get = (url: string) => server.inject({ method: 'GET', url: `/api/v1${url}` });

describe('GET /accounts/:id/positioning', () => {
  it('ranks plays with evidence, the person to approach and a pipeline-derived deal range', async () => {
    const res = await get(`/accounts/${c.acme}/positioning`);
    expect(res.statusCode).toBe(200);
    const body = res.json<AccountPositioning>();
    expect(body.plays.length).toBeGreaterThan(0);
    const data = body.plays.find((p) => p.theme === 'data_ai')!;
    expect(data.rank).toBe(1);
    expect(data.whyNow.some((e) => e.kind === 'hiring' && e.anchor === 'hiring-now')).toBe(true);
    expect(data.approach[0]).toMatchObject({ name: 'Rita Gomes', met: true, seniority: 'c_level' });
    expect(data.dealRange).toMatchObject({ deals: 4 });
    expect(data.firstStep).toContain('Rita Gomes');
    expect(body.brief).toMatchObject({ name: `${TAG} Acme`, industry: 'Retail', employees: { value: 1500, source: 'Enrichment cache' }, pipeline: { openCount: 1 } });
    expect(body.brief.people).toMatchObject({ known: 2, senior: 1, metLast12m: 1 });
    expect(body.gaps.map((g) => g.kind)).toContain('restructuring');
    expect(body.gaps.map((g) => g.kind)).not.toContain('senior_contacts');
  });

  it('returns honest gaps and no plays for an empty account', async () => {
    const body = (await get(`/accounts/${c.empty}/positioning`)).json<AccountPositioning>();
    expect(body.plays).toEqual([]);
    expect(body.gaps.map((g) => g.kind)).toEqual(expect.arrayContaining(['senior_contacts', 'no_recent_meeting', 'no_pipeline']));
    expect(body.brief.employees).toBeNull();
  });

  it('404s across orgs', async () => {
    expect((await get(`/accounts/${c.other}/positioning`)).statusCode).toBe(404);
    expect((await get(`/accounts/${c.other}/key-numbers`)).statusCode).toBe(404);
  });
});

describe('GET /accounts/:id/key-numbers', () => {
  it('gives every number a source and period, and null with a reason when there is no data', async () => {
    const body = (await get(`/accounts/${c.acme}/key-numbers`)).json<AccountKeyNumbers>();
    const by = Object.fromEntries(body.items.map((i) => [i.id, i]));
    expect(Object.keys(by)).toEqual(['employees', 'revenue', 'margin', 'open_jobs', 'momentum', 'senior_coverage', 'last_meeting', 'pipeline', 'fin_warnings', 'sentiment']);
    expect(by.employees).toMatchObject({ value: 1500, delta: 12, source: 'Enrichment cache' });
    expect(by.revenue).toMatchObject({ value: null });
    expect(by.revenue!.missing).toBeTruthy();
    expect(by.open_jobs).toMatchObject({ value: 5, sub: '4 posted in 90 days' });
    expect(by.senior_coverage).toMatchObject({ value: 1, sub: 'of 1 senior (C-level, VP) known' });
    expect(by.last_meeting!.value).toBe(12);
    expect(by.pipeline).toMatchObject({ value: 3_000_000_000_000 });
    expect(by.sentiment!.value).toBeCloseTo(-0.1, 2);
    for (const i of body.items) {
      expect(i.source).toBeTruthy();
      expect(i.period).toBeTruthy();
      if (i.value === null) expect(i.missing).toBeTruthy();
    }
  });
});

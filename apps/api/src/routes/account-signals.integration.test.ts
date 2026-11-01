// v21 account signals: pulse, timeline, initiatives and portfolio momentum.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { prisma } from '@bidstack/db';

import { invalidateAccessScope } from '../lib/access-scope.js';
import { buildServer } from '../server.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../test-support/isolated-org.js';

const TAG = `sig${Date.now()}`;
const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY);
let server: FastifyInstance;
let orgA = { orgId: '', clerkOrg: '' };
let orgB = { orgId: '', clerkOrg: '' };
let restoreAuth: (() => void) | null = null;
const c: Record<string, string> = {};

beforeAll(async () => {
  orgA = await createIsolatedOrg('sig-a');
  orgB = await createIsolatedOrg('sig-b');
  restoreAuth = useIsolatedOrgAuth(orgA.clerkOrg);
  const o = orgA.orgId;
  c.acme = (await prisma.company.create({ data: { orgId: o, name: `${TAG} Acme`, countryCode: 'BR' } })).id;
  c.child = (await prisma.company.create({ data: { orgId: o, name: `${TAG} Acme US`, parentId: c.acme } })).id;
  c.quiet = (await prisma.company.create({ data: { orgId: o, name: `${TAG} Quiet`, countryCode: 'BR' } })).id;
  c.other = (await prisma.company.create({ data: { orgId: orgB.orgId, name: `${TAG} Other` } })).id;
  const opp = (code: string, stage: string, value: bigint, created: Date, companyId = c.acme!) =>
    prisma.opportunity.create({ data: { orgId: o, code: `${TAG}-${code}`, customer: `${TAG} Acme`, name: `${TAG} ${code}`, stage: stage as never, valueMicros: value, companyId, createdAt: created } });
  await opp('old', 's1_lead', 1_000_000_000_000n, ago(200));
  await opp('new', 's2_sent', 2_000_000_000_000n, ago(40));
  await opp('won', 'closed_won', 500_000_000_000n, ago(150));
  await opp('quiet', 's1_lead', 100_000_000_000n, ago(300), c.quiet);
  await prisma.meetingIntel.create({
    data: { orgId: o, companyId: c.child!, title: `${TAG} QBR`, heldAt: ago(4), visibility: 'org', dedupeKey: `${TAG}-qbr`.padEnd(20, 'x'), opportunities: ['Data platform consolidation'], challenges: [] },
  });
  await prisma.meetingIntel.create({ data: { orgId: o, companyId: c.acme!, title: `${TAG} Intro`, heldAt: ago(30), visibility: 'org', dedupeKey: `${TAG}-intro`.padEnd(20, 'x') } });
  for (let i = 0; i < 8; i++) {
    await prisma.companyJobPosting.create({
      data: { orgId: o, companyId: c.acme!, source: 'apollo', externalId: `${TAG}-j${i}`, title: `Data Engineer ${i}`, region: 'EMEA', function: 'data', seniority: 'mid', skills: [], fetchedAt: new Date(), postedAt: ago(i < 6 ? 3 : 40) },
    });
  }
  await prisma.companyFirmographics.create({
    data: {
      orgId: o,
      companyId: c.acme!,
      status: 'ok',
      headcountGrowth12m: 0.08,
      locations: [],
      providerIds: {},
      provenance: {},
      providerStatus: {},
      fetchedAt: new Date(),
      projects: [
        { id: 'data_platform:EMEA', kind: 'data_platform', name: 'Data platform build-out', rationale: 'Six data engineering roles in EMEA.', confidence: 'medium', region: 'EMEA', postingCount: 6, seniorCount: 1, skills: ['spark'], evidence: [{ postingId: 'p1', title: 'Data Engineer', url: 'https://jobs.example/1', region: 'EMEA', seniority: 'mid', postedAt: ago(3).toISOString(), source: 'apollo' }], method: 'rules' },
      ],
    },
  });
  const ev = (externalId: string, kind: string, title: string, days: number, extra: Record<string, unknown> = {}) =>
    prisma.accountWatchEvent.create({
      data: { orgId: o, companyId: c.acme!, source: 'gdelt', externalId: `${TAG}-${externalId}`, kind: kind as never, occurredAt: ago(days), title, sourceUrl: `https://news.example/${externalId}`, summary: title, implication: 'OPPORTUNITY', severity: 3, ...extra },
    });
  await ev('fund', 'FUNDING_ROUND', `${TAG} Acme raises $40M to scale its data platform`, 10, { importance: 85, sentiment: 0.8 });
  await ev('launch', 'PRODUCT_LAUNCH', 'Sample: Acme launches a new customer app', 20, { importance: 55, sentiment: 0.5, sample: true, source: 'sample', sourceUrl: '' });
  await ev('gone', 'NEWS_SIGNAL', 'Dismissed story', 5, { status: 'DISMISSED', importance: 90 });
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

describe('GET /accounts/:id/pulse', () => {
  it('scores a growing account as gaining with drivers, coverage and sources', async () => {
    const res = await get(`/accounts/${c.acme}/pulse`);
    expect(res.statusCode).toBe(200);
    const p = res.json();
    expect(p.score).toBeGreaterThan(60);
    expect(['gaining', 'steady']).toContain(p.trend);
    expect(p.series).toHaveLength(13);
    expect(p.drivers.length).toBeGreaterThanOrEqual(3);
    expect(p.drivers.map((d: { key: string }) => d.key)).toEqual(expect.arrayContaining(['pipeline', 'meetings', 'hiring', 'news']));
    expect(p.sample).toBe(true);
    expect(p.sources.find((s: { id: string }) => s.id === 'meetings').active).toBe(true);
    expect(p.verdict).not.toMatch(/[\u2014]/);
  });

  it('is neutral for an account with only an old open deal', async () => {
    const p = (await get(`/accounts/${c.quiet}/pulse`)).json();
    expect(p.score).toBeLessThanOrEqual(55);
    expect(p.sample).toBe(false);
  });

  it('404s across orgs', async () => {
    expect((await get(`/accounts/${c.other}/pulse`)).statusCode).toBe(404);
  });
});

describe('GET /accounts/:id/timeline', () => {
  it('merges our activity and their events, children included, dismissed excluded', async () => {
    const res = await get(`/accounts/${c.acme}/timeline`);
    expect(res.statusCode).toBe(200);
    const t = res.json();
    const cats = new Set(t.items.map((i: { category: string }) => i.category));
    expect(cats).toEqual(new Set(['meeting', 'deal', 'funding', 'launch', 'hiring']));
    expect(t.items.some((i: { title: string }) => i.title === `${TAG} QBR`)).toBe(true);
    expect(t.items.some((i: { title: string }) => i.title === 'Dismissed story')).toBe(false);
    const sample = t.items.find((i: { category: string }) => i.category === 'launch');
    expect(sample.title).toBe('Acme launches a new customer app');
    expect(sample.sample).toBe(true);
    expect(sample.lane).toBe('theirs');
    expect(t.items.find((i: { category: string }) => i.category === 'deal').lane).toBe('ours');
    expect(t.counts.meeting).toBe(2);
  });

  it('filters by category', async () => {
    const t = (await get(`/accounts/${c.acme}/timeline?categories=funding,meeting`)).json();
    expect(new Set(t.items.map((i: { category: string }) => i.category))).toEqual(new Set(['funding', 'meeting']));
    expect(t.counts.deal).toBeGreaterThan(0);
  });
});

describe('GET /accounts/:id/initiatives', () => {
  it('joins hiring, news and meetings into one initiative with a hook', async () => {
    const res = await get(`/accounts/${c.acme}/initiatives`);
    expect(res.statusCode).toBe(200);
    const items = res.json().items;
    const data = items.find((i: { theme: string }) => i.theme === 'data_ai');
    expect(data).toBeTruthy();
    expect(new Set(data.evidence.map((e: { kind: string }) => e.kind))).toEqual(new Set(['hiring', 'funding', 'meeting']));
    expect(data.confidence).toBe('high');
    expect(data.hook.offering).toBe('Data and AI practice');
    expect(data.sample).toBe(false);
    const cx = items.find((i: { theme: string }) => i.theme === 'digital_cx');
    expect(cx.sample).toBe(true);
  });
});

describe('GET /portfolio/momentum', () => {
  it('ranks readable root accounts and lists top alerts', async () => {
    const res = await get('/portfolio/momentum');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const names = body.accounts.map((a: { companyName: string }) => a.companyName);
    expect(names).toContain(`${TAG} Acme`);
    expect(names).toContain(`${TAG} Quiet`);
    expect(names).not.toContain(`${TAG} Acme US`);
    expect(names).not.toContain(`${TAG} Other`);
    const acme = body.accounts.find((a: { companyName: string }) => a.companyName === `${TAG} Acme`);
    expect(acme.openPipelineMicros).toBe('3000000000000');
    expect(acme.series).toHaveLength(8);
    expect(body.counts.gaining + body.counts.steady + body.counts.declining).toBe(body.accounts.length);
    expect(body.alerts[0].title).toBe(`${TAG} Acme raises $40M to scale its data platform`);
    expect(body.alerts.some((a: { title: string }) => a.title === 'Dismissed story')).toBe(false);
  });
});

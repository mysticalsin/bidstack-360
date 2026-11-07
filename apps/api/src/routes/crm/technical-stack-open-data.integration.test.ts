// Slice 16: the open_data lane of POST /crm/companies/:key/technical-stack/refresh
// runs the open data detector, reports per lane counts, persists evidence and
// only falls back to Apollo when open data is thin. Happy path, validation 400,
// RBAC 403, tenant isolation 404, idempotent retries.

import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';
import { createCrtShState, type DnsResolverLike, type PublicGet } from '@bidstack/shared/server';

import { buildServer } from '../../server.js';
import {
  __setOpenTechApolloEnqueueForTest,
  __setOpenTechDetectDepsForTest,
} from '../../services/crm/open-tech-stack.service.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
  type IsolatedOrg,
} from '../../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../../test-support/skip-if-no-db.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgA: IsolatedOrg | null = null;
let orgB: IsolatedOrg | null = null;
let restoreAuth: (() => void) | null = null;
let prevRoleHeader: string | undefined;
const READ_ONLY = { 'x-bidstack-e2e-role': 'read-only' };
const tag = randomUUID().slice(0, 8);
const NAME = `Open Stack Labs ${tag}`;
const DOMAIN = `openstack-${tag}.example`;
let companyId = '';
let foreignCompanyId = '';

const richResolver: DnsResolverLike = {
  resolveMx: async () => [{ exchange: 'x.mail.protection.outlook.com' }],
  resolveTxt: async () => [['v=spf1 include:spf.protection.outlook.com include:mail.zendesk.com ~all'], ['atlassian-domain-verification=t'], ['docusign=1']],
  resolveNs: async () => ['ada.ns.cloudflare.com'],
  resolveCname: async () => [],
};
const thinResolver: DnsResolverLike = { ...richResolver, resolveTxt: async () => [], resolveNs: async () => [] };
const get: PublicGet = async (url) => {
  if (url.startsWith('https://crt.sh/')) return { url, status: 200, headers: {}, body: JSON.stringify([{ name_value: `jira.${DOMAIN}` }]) };
  if (url.endsWith('/robots.txt')) return { url, status: 404, headers: {}, body: '' };
  if (url === `https://${DOMAIN}/`) return { url, status: 200, headers: { 'cf-ray': '1' }, body: '<script src="https://www.googletagmanager.com/gtm.js"></script>' };
  return { url, status: 404, headers: {}, body: '' };
};

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  prevRoleHeader = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
  orgA = await createIsolatedOrg('techopen');
  orgB = await createIsolatedOrg('techopenb');
  restoreAuth = useIsolatedOrgAuth(orgA.clerkOrg);
  const company = await prisma.company.create({
    data: { orgId: orgA.orgId, name: NAME, domain: DOMAIN, website: `https://${DOMAIN}/`, source: 'manual', confidence: 0.7 },
    select: { id: true },
  });
  companyId = company.id;
  const now = new Date();
  await prisma.companyJobPosting.createMany({
    data: [
      { orgId: orgA.orgId, companyId, source: 'greenhouse', externalId: `${tag}-1`, title: 'Senior Data Engineer, Snowflake', url: 'https://boards.greenhouse.io/x/1', region: 'emea', function: 'data', seniority: 'senior', skills: ['Snowflake', 'Python'], fetchedAt: now },
      { orgId: orgA.orgId, companyId, source: 'greenhouse', externalId: `${tag}-2`, title: 'Platform Engineer, Kubernetes on AWS', region: 'emea', function: 'infrastructure', seniority: 'mid', skills: ['Kubernetes', 'AWS'], fetchedAt: now },
    ],
  });
  const foreign = await prisma.company.create({
    data: { orgId: orgB.orgId, name: `Foreign Stack ${tag}`, domain: `foreign-${tag}.example`, source: 'manual', confidence: 0.7 },
    select: { id: true },
  });
  foreignCompanyId = foreign.id;
  server = await buildServer();
  await server.ready();
});

afterEach(() => {
  __setOpenTechDetectDepsForTest(null);
  __setOpenTechApolloEnqueueForTest(null);
});

afterAll(async () => {
  restoreAuth?.();
  if (prevRoleHeader === undefined) delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  else process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = prevRoleHeader;
  if (server) await server.close();
  if (orgA) await dropIsolatedOrg(orgA.orgId);
  if (orgB) await dropIsolatedOrg(orgB.orgId);
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!orgA && !!orgB);

async function withApolloKey<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.APOLLO_API_KEY;
  process.env.APOLLO_API_KEY = 'test-placeholder';
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.APOLLO_API_KEY;
    else process.env.APOLLO_API_KEY = prev;
  }
}

const refresh = (key: string, headers: Record<string, string> = {}) =>
  server.inject({ method: 'POST', url: `/api/crm/companies/${encodeURIComponent(key)}/technical-stack/refresh`, payload: {}, headers });

describe('technical stack refresh, open data lane', () => {
  skipIfNoDb('runs every lane, reports counts and skips Apollo when open data is rich', async () => {
    __setOpenTechDetectDepsForTest({ network: true, resolver: richResolver, get, sleep: async () => {}, ct: createCrtShState() });
    const enqueued: string[] = [];
    __setOpenTechApolloEnqueueForTest(async (job) => {
      enqueued.push(job.companyName);
      return 'job-1';
    });
    const res = await withApolloKey(() => refresh(companyId));
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const open = body.providers.find((p: { id: string }) => p.id === 'open_data');
    expect(open.status).toBe('synced');
    expect(Object.fromEntries(open.lanes.map((l: { lane: string; status: string; count: number }) => [l.lane, [l.status, l.count]]))).toEqual({
      dns: ['found', 5],
      ct: ['found', 1],
      web: ['found', 2],
      jobs: ['found', 4],
      github: ['skipped', 0],
    });
    expect(open.message).toContain('Nothing found in GitHub');
    const apollo = body.providers.find((p: { id: string }) => p.id === 'apollo');
    expect(apollo).toMatchObject({ status: 'skipped' });
    expect(enqueued).toEqual([]);
    expect(body.state.coverage).toMatchObject({ apolloFallback: 'not_needed', apolloThreshold: 5, sample: false });
    const names = body.state.providerStack.flatMap((c: { items: Array<{ name: string }> }) => c.items.map((i) => i.name));
    expect(names).toEqual(expect.arrayContaining(['Microsoft 365', 'Zendesk', 'Jira', 'Google Tag Manager', 'Snowflake', 'Kubernetes']));
    const m365 = body.state.providerStack.flatMap((c: { items: unknown[] }) => c.items).find((i: { name: string }) => i.name === 'Microsoft 365');
    expect(m365).toMatchObject({ source: 'open_data:dns', evidence: { record: expect.stringContaining('MX') } });

    const read = await server.inject({ method: 'GET', url: `/api/crm/companies/${companyId}/technical-stack` });
    expect(read.statusCode).toBe(200);
    expect(read.json().coverage.lanes).toHaveLength(5);
  });

  skipIfNoDb('queues Apollo organization enrichment when open data is thin', async () => {
    __setOpenTechDetectDepsForTest({ network: true, resolver: thinResolver, get: async (url) => ({ url, status: 503, headers: {}, body: '' }), sleep: async () => {}, ct: createCrtShState() });
    await prisma.companyJobPosting.deleteMany({ where: { orgId: orgA!.orgId, companyId } });
    const enqueued: Array<{ companyName: string; domain?: string | null }> = [];
    __setOpenTechApolloEnqueueForTest(async (job) => {
      enqueued.push(job);
      return 'job-2';
    });
    const res = await withApolloKey(() => refresh(companyId));
    expect(res.statusCode).toBe(200);
    expect(res.json().providers.find((p: { id: string }) => p.id === 'apollo')).toMatchObject({ status: 'queued' });
    expect(enqueued).toEqual([{ orgId: orgA!.orgId, companyName: NAME, domain: DOMAIN }]);
    expect(res.json().state.coverage.apolloFallback).toBe('queued');
  });

  skipIfNoDb('does not queue Apollo without a key, and says so', async () => {
    __setOpenTechDetectDepsForTest({ network: false });
    const enqueued: unknown[] = [];
    __setOpenTechApolloEnqueueForTest(async (job) => {
      enqueued.push(job);
      return 'job-3';
    });
    const prev = process.env.APOLLO_API_KEY;
    delete process.env.APOLLO_API_KEY;
    try {
      const res = await refresh(companyId);
      expect(res.statusCode).toBe(200);
      expect(res.json().providers.find((p: { id: string }) => p.id === 'apollo').status).toBe('disabled');
      expect(enqueued).toEqual([]);
    } finally {
      if (prev !== undefined) process.env.APOLLO_API_KEY = prev;
    }
  });

  skipIfNoDb('retries are idempotent: one item per technology and lane', async () => {
    __setOpenTechDetectDepsForTest({ network: true, resolver: richResolver, get, sleep: async () => {}, ct: createCrtShState() });
    __setOpenTechApolloEnqueueForTest(async () => null);
    await refresh(companyId);
    const second = await refresh(companyId);
    expect(second.statusCode).toBe(200);
    const row = await prisma.companyEnrichment.findFirstOrThrow({ where: { orgId: orgA!.orgId, normalizedName: NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-') } });
    const items = (row.providerMetadata as { openTechStack: { items: Array<{ lane: string; name: string }> } }).openTechStack.items;
    const keys = items.map((i) => `${i.lane}:${i.name}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  skipIfNoDb('rejects a bad key, a read-only role and another org', async () => {
    __setOpenTechDetectDepsForTest({ network: false });
    expect((await refresh('x'.repeat(300))).statusCode).toBe(400);
    expect((await server.inject({ method: 'POST', url: `/api/crm/companies/${companyId}/technical-stack/refresh`, payload: { unexpected: true } })).statusCode).toBe(400);
    expect((await refresh(companyId, READ_ONLY)).statusCode).toBe(403);
    expect((await refresh(foreignCompanyId)).statusCode).toBe(404);
    expect((await server.inject({ method: 'GET', url: `/api/crm/companies/${foreignCompanyId}/technical-stack` })).statusCode).toBe(404);
  });
});

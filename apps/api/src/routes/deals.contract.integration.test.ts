// Contract test for the deals section API (opportunities, timeline, win/loss,
// bid scores, forecasts, cross-sell, analytics): validation 400, RBAC 403,
// tenant isolation 404, pagination bounds and retry-safe writes.
import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let otherOrgId: string | null = null;
let foreignOppId = '';
let overdueOppId = '';
let futureOppId = '';
let restoreAuth: (() => void) | null = null;
let previousRoleHeader: string | undefined;
const TAG = `deals-contract-${Date.now()}`;
const READ_ONLY = { 'x-bidstack-e2e-role': 'read-only' };

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  previousRoleHeader = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
  const org = await createIsolatedOrg('deals-contract');
  const other = await createIsolatedOrg('deals-contract-other');
  orgId = org.orgId;
  otherOrgId = other.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);

  const base = { customer: `${TAG} Co`, stage: 's1_lead' as const };
  const foreign = await prisma.opportunity.create({
    data: { ...base, orgId: otherOrgId, code: `${TAG}-X`, name: `${TAG} foreign` },
  });
  foreignOppId = foreign.id;
  const day = 86_400_000;
  const overdue = await prisma.opportunity.create({
    data: {
      ...base,
      orgId,
      code: `${TAG}-OD`,
      name: `${TAG} overdue`,
      dueDate: new Date(Date.now() - 10 * day),
    },
  });
  overdueOppId = overdue.id;
  const future = await prisma.opportunity.create({
    data: {
      ...base,
      orgId,
      code: `${TAG}-FU`,
      name: `${TAG} future`,
      dueDate: new Date(Date.now() + 30 * day),
    },
  });
  futureOppId = future.id;

  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (server) await server.close();
  if (restoreAuth) restoreAuth();
  if (previousRoleHeader === undefined) delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  else process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previousRoleHeader;
  if (orgId) await dropIsolatedOrg(orgId);
  if (otherOrgId) await dropIsolatedOrg(otherOrgId);
  if (dbReachable) await prisma.$disconnect();
});

const t = makeSkipIfNoDb(() => dbReachable && !!orgId && !!otherOrgId);

function csvCodes(body: string): string[] {
  return body
    .split('\r\n')
    .slice(1)
    .filter(Boolean)
    .map((line) => line.split(',')[0]!);
}

describe('opportunity list and export filters', () => {
  t('overdue=false is not read as overdue=true', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/opportunities?search=${TAG}&overdue=false&limit=200`,
    });
    expect(res.statusCode, res.body).toBe(200);
    const codes = (res.json() as { items: Array<{ code: string }> }).items.map((o) => o.code);
    expect(codes).toEqual(expect.arrayContaining([`${TAG}-OD`, `${TAG}-FU`]));
  });

  t('export honours search and the overdue chip', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/opportunities/export?search=${TAG}&overdue=true`,
    });
    expect(res.statusCode).toBe(200);
    expect(csvCodes(res.body)).toEqual([`${TAG}-OD`]);
  });

  t('export honours the due-within window', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/opportunities/export?search=${TAG}&dueWithinDays=60`,
    });
    expect(res.statusCode).toBe(200);
    expect(csvCodes(res.body)).toEqual([`${TAG}-FU`]);
  });

  t('export rejects an unknown stage with 400 instead of a broken stream', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/opportunities/export?stage=bogus' });
    expect(res.statusCode).toBe(400);
  });
});

describe('validation and pagination bounds', () => {
  for (const url of [
    '/api/opportunities?limit=0',
    '/api/opportunities?limit=201',
    '/api/opportunities?cursor=not-a-uuid',
    '/api/opportunities/not-a-uuid',
    `/api/opportunities/${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}/timeline?limit=101`,
    '/api/bid-scores?limit=0',
    '/api/win-loss/analysis?from=yesterday',
  ]) {
    t(`GET ${url} is 400`, async () => {
      const res = await server.inject({ method: 'GET', url });
      expect(res.statusCode, res.body).toBe(400);
    });
  }

  t('PATCH with an invalid probability is 400', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/opportunities/${futureOppId}`,
      payload: { probability: 900 },
    });
    expect(res.statusCode).toBe(400);
  });

  t('a page walk never repeats a row', async () => {
    const seen = new Set<string>();
    let cursor: string | null = null;
    for (let i = 0; i < 50; i += 1) {
      const res = await server.inject({
        method: 'GET',
        url: `/api/opportunities?limit=5${cursor ? `&cursor=${cursor}` : ''}`,
      });
      expect(res.statusCode).toBe(200);
      const page = res.json() as { items: Array<{ id: string }>; nextCursor: string | null };
      expect(page.items.length).toBeLessThanOrEqual(5);
      for (const item of page.items) {
        expect(seen.has(item.id)).toBe(false);
        seen.add(item.id);
      }
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(cursor).toBeNull();
  });
});

describe('RBAC', () => {
  for (const [method, path, payload] of [
    ['PATCH', '/api/opportunities/:id', { name: 'nope' }],
    ['POST', '/api/opportunities/:id/stage', { stage: 's2_sent' }],
    ['DELETE', '/api/opportunities/:id', undefined],
    ['PUT', '/api/win-loss/:id', { outcome: 'won', reason: 'price' }],
  ] as const) {
    const url = () => path.replace(':id', futureOppId);
    t(`read-only ${method} ${path} is 403`, async () => {
      const res = await server.inject({
        method,
        url: url(),
        headers: READ_ONLY,
        ...(payload ? { payload } : {}),
      });
      expect(res.statusCode, res.body).toBe(403);
    });
  }

  t('the blocked writes left the deal untouched', async () => {
    const row = await prisma.opportunity.findUniqueOrThrow({ where: { id: futureOppId } });
    expect(row.name).toBe(`${TAG} future`);
    expect(row.deletedAt).toBeNull();
  });
});

describe('tenant isolation', () => {
  for (const [method, path] of [
    ['GET', '/api/opportunities/:id'],
    ['GET', '/api/opportunities/:id/timeline'],
    ['GET', '/api/opportunities/:id/contacts'],
    ['GET', '/api/win-loss/:id'],
    ['PATCH', '/api/opportunities/:id'],
    ['DELETE', '/api/opportunities/:id'],
  ] as const) {
    const url = () => path.replace(':id', foreignOppId);
    t(`${method} ${path} for another org's deal is 404`, async () => {
      const res = await server.inject({
        method,
        url: url(),
        ...(method === 'PATCH' ? { payload: { name: 'stolen' } } : {}),
      });
      expect(res.statusCode, res.body).toBe(404);
    });
  }

  t('list and export never carry the other org', async () => {
    const list = await server.inject({ method: 'GET', url: `/api/opportunities?search=${TAG}` });
    expect(JSON.stringify(list.json())).not.toContain(foreignOppId);
    const csv = await server.inject({ method: 'GET', url: `/api/opportunities/export?search=${TAG}` });
    expect(csvCodes(csv.body)).not.toContain(`${TAG}-X`);
  });
});

describe('retry-safe writes', () => {
  t('a repeated PATCH lands the same state', async () => {
    const payload = { name: `${TAG} renamed`, probability: 40 };
    const first = await server.inject({ method: 'PATCH', url: `/api/opportunities/${futureOppId}`, payload });
    const second = await server.inject({ method: 'PATCH', url: `/api/opportunities/${futureOppId}`, payload });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ name: payload.name, probability: 40 });
  });

  t('a repeated win/loss PUT keeps one record', async () => {
    const payload = { outcome: 'lost', reason: 'price' };
    for (let i = 0; i < 2; i += 1) {
      const res = await server.inject({ method: 'PUT', url: `/api/win-loss/${overdueOppId}`, payload });
      expect(res.statusCode, res.body).toBe(200);
    }
    expect(await prisma.winLossRecord.count({ where: { opportunityId: overdueOppId } })).toBe(1);
  });

  t('a repeated stage move is a no-op the second time', async () => {
    const body = { stage: 's2_sent' };
    const first = await server.inject({ method: 'POST', url: `/api/opportunities/${futureOppId}/stage`, payload: body });
    const second = await server.inject({ method: 'POST', url: `/api/opportunities/${futureOppId}/stage`, payload: body });
    expect(first.statusCode, first.body).toBe(200);
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json()).toMatchObject({ stage: 's2_sent' });
  });

  t('a retried DELETE answers 404, not 500', async () => {
    const first = await server.inject({ method: 'DELETE', url: `/api/opportunities/${overdueOppId}` });
    const second = await server.inject({ method: 'DELETE', url: `/api/opportunities/${overdueOppId}` });
    expect(first.statusCode).toBe(204);
    expect(second.statusCode).toBe(404);
  });
});

describe('section aggregates answer for a fresh org', () => {
  for (const url of [
    '/api/win-loss/analysis',
    '/api/win-loss/patterns',
    '/api/forecasts',
    '/api/forecasts/projection',
    '/api/bid-scores',
    '/api/sector-view',
    '/api/cross-sell-actions',
    '/api/dashboards',
  ]) {
    t(`GET ${url} is 200`, async () => {
      const res = await server.inject({ method: 'GET', url });
      expect(res.statusCode, res.body).toBe(200);
    });
  }
});

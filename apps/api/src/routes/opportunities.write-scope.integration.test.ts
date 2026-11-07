// Integration test for M7 access scoping on every by-id opportunity route
// beyond GET /opportunities/:id. Regression: list, count and detail were
// scoped, but PATCH, DELETE, stage moves, brief, timeline, deal contacts,
// win/loss records and bid scores only checked orgId, so a country-restricted
// user could read or change a deal they cannot open.
//
// Same harness as opportunities.detail-scope.integration.test.ts: the isolated
// org's admin joins a fresh FR-only group; the DE deal (no owner) is out of scope.
import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import { invalidateAccessScope } from '../lib/access-scope.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let stubUserId: string | null = null;
let groupId: string | null = null;
let frOppId = '';
let deOppId = '';
let contactId = '';
let restoreAuth: (() => void) | null = null;
const TAG = `write-scope-${Date.now()}`;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const org = await createIsolatedOrg('opportunity-write-scope');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  const user = await prisma.user.findFirst({ where: { orgId }, orderBy: { createdAt: 'asc' } });
  stubUserId = user?.id ?? null;
  if (!stubUserId) return;

  const group = await prisma.userGroup.create({
    data: { orgId, name: `${TAG}-grp`, scopeCountries: ['FR'], scopeAll: false },
  });
  groupId = group.id;
  await prisma.userGroupMember.create({ data: { orgId, userId: stubUserId, groupId: group.id } });

  const base = { orgId, customer: 'ScopeCo', stage: 's1_lead' as const, ownerId: null };
  const fr = await prisma.opportunity.create({
    data: { ...base, code: `${TAG}-FR`, name: 'FR deal', country: 'FR' },
  });
  const de = await prisma.opportunity.create({
    data: { ...base, code: `${TAG}-DE`, name: 'DE deal', country: 'DE' },
  });
  frOppId = fr.id;
  deOppId = de.id;
  const contact = await prisma.contact.create({
    data: { orgId, name: `${TAG} contact`, email: `${TAG}@scope.test`, customer: 'ScopeCo' },
  });
  contactId = contact.id;
  await prisma.bidScore.create({
    data: {
      orgId,
      opportunityId: deOppId,
      scoredBy: stubUserId,
      criteria: {},
      totalScore: 40,
      categoryScores: {},
      weightedSum: 0,
      totalWeight: 0,
      recommendation: 'no_bid',
      memosPolicies: [],
    },
  });

  server = await buildServer();
  await server.ready();
  invalidateAccessScope(orgId, stubUserId);
});

afterAll(async () => {
  if (orgId) {
    await prisma.winLossRecord.deleteMany({ where: { orgId } }).catch(() => undefined);
    await prisma.bidScore.deleteMany({ where: { orgId } }).catch(() => undefined);
    await prisma.opportunityContact.deleteMany({ where: { orgId } }).catch(() => undefined);
    if (stubUserId && groupId) {
      await prisma.userGroupMember.deleteMany({ where: { orgId, userId: stubUserId, groupId } });
    }
    if (groupId) await prisma.userGroup.deleteMany({ where: { id: groupId } });
    if (stubUserId) invalidateAccessScope(orgId, stubUserId);
  }
  if (server) await server.close();
  if (restoreAuth) restoreAuth();
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
});

const t = makeSkipIfNoDb(() => dbReachable && !!orgId && !!stubUserId);

type Call = { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; url: string; payload?: object };

const calls = (id: string): Array<[string, Call]> => [
  ['PATCH deal', { method: 'PATCH', url: `/api/opportunities/${id}`, payload: { name: 'renamed' } }],
  ['stage move', { method: 'POST', url: `/api/opportunities/${id}/stage`, payload: { stage: 's1_ongoing' } }],
  ['timeline', { method: 'GET', url: `/api/opportunities/${id}/timeline` }],
  ['contacts list', { method: 'GET', url: `/api/opportunities/${id}/contacts` }],
  [
    'contact link',
    { method: 'POST', url: `/api/opportunities/${id}/contacts`, payload: { contactId, role: 'other' } },
  ],
  ['win/loss read', { method: 'GET', url: `/api/win-loss/${id}` }],
  [
    'win/loss write',
    { method: 'PUT', url: `/api/win-loss/${id}`, payload: { outcome: 'won', reason: 'price' } },
  ],
  ['bid score latest', { method: 'GET', url: `/api/bid-scores/${id}/latest` }],
  ['DELETE deal', { method: 'DELETE', url: `/api/opportunities/${id}` }],
];

describe('opportunity by-id routes honour access scope', () => {
  for (const [label] of calls('x')) {
    t(`${label}: out-of-scope deal is 404`, async () => {
      const call = calls(deOppId).find(([l]) => l === label)![1];
      const res = await server.inject(call);
      expect(res.statusCode, res.body).toBe(404);
    });
  }

  t('bid score list leaves out scores on out-of-scope deals', async () => {
    const all = await server.inject({ method: 'GET', url: '/api/bid-scores' });
    expect(all.statusCode, all.body).toBe(200);
    const ids = (all.json() as { items: Array<{ opportunityId: string }> }).items.map(
      (s) => s.opportunityId,
    );
    expect(ids).not.toContain(deOppId);
  });

  t('out-of-scope deal is unchanged after the blocked writes', async () => {
    const de = await prisma.opportunity.findUniqueOrThrow({ where: { id: deOppId } });
    expect(de.name).toBe('DE deal');
    expect(de.stage).toBe('s1_lead');
    expect(de.deletedAt).toBeNull();
    expect(await prisma.winLossRecord.count({ where: { opportunityId: deOppId } })).toBe(0);
  });

  t('in-scope deal still reads and writes', async () => {
    const patch = await server.inject({
      method: 'PATCH',
      url: `/api/opportunities/${frOppId}`,
      payload: { name: 'FR renamed' },
    });
    expect(patch.statusCode, patch.body).toBe(200);
    const timeline = await server.inject({ method: 'GET', url: `/api/opportunities/${frOppId}/timeline` });
    expect(timeline.statusCode).toBe(200);
    const contacts = await server.inject({ method: 'GET', url: `/api/opportunities/${frOppId}/contacts` });
    expect(contacts.statusCode).toBe(200);
    const winLoss = await server.inject({ method: 'GET', url: `/api/win-loss/${frOppId}` });
    expect(winLoss.statusCode).toBe(200);
  });
});

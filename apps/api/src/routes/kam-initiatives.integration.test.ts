// Integration tests for /api/v1/kam/initiatives/* against the live dev DB.
// Targets the red-team's high-stakes failure modes: illegal-transition rejection
// (M2), atomic mint+handoff with companyId set (B2/M1), terminal/double-transition
// 409 (no double-mint, B2), cross-tenant FK graft (B3), dropped-requires-reason.

import { randomUUID } from 'node:crypto';

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
let orgId = '';
let companyId = '';
let otherOrgId = '';
let otherCompanyId = '';
let restoreAuth: (() => void) | undefined;
const createdInitiativeIds: string[] = [];
const createdOpportunityIds: string[] = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const org = await createIsolatedOrg('kam-initiatives');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  const company = await prisma.company.create({
    data: { orgId, name: `KAM-Test-${randomUUID().slice(0, 8)}`, source: 'manual' },
  });
  companyId = company.id;
  // A foreign tenant for the cross-tenant FK-graft test.
  const other = await prisma.org.create({
    data: { clerkOrg: `org_kam_other_${randomUUID().slice(0, 8)}`, name: 'KAM Other Org' },
  });
  otherOrgId = other.id;
  const otherCompany = await prisma.company.create({
    data: { orgId: otherOrgId, name: `KAM-Other-${randomUUID().slice(0, 8)}`, source: 'manual' },
  });
  otherCompanyId = otherCompany.id;

  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (server) await server.close();
  if (!dbReachable) return;
  // Handoffs cascade on initiative delete; delete minted opps, then initiatives,
  // then the throwaway companies + foreign org.
  try {
    if (createdInitiativeIds.length) {
      await prisma.kamHandoff.deleteMany({ where: { initiativeId: { in: createdInitiativeIds } } });
      await prisma.kamInitiative.deleteMany({ where: { id: { in: createdInitiativeIds } } });
    }
    if (createdOpportunityIds.length) {
      await prisma.opportunity.deleteMany({ where: { id: { in: createdOpportunityIds } } });
    }
    if (companyId) await prisma.company.deleteMany({ where: { id: companyId } });
    if (otherCompanyId) await prisma.company.deleteMany({ where: { id: otherCompanyId } });
    if (otherOrgId) await prisma.org.deleteMany({ where: { id: otherOrgId } });
  } catch {
    /* ignore */
  }
  restoreAuth?.();
  if (orgId) await dropIsolatedOrg(orgId);
  await prisma.$disconnect();
});

const t = makeSkipIfNoDb(() => dbReachable);

async function createInitiative(extra: Record<string, unknown> = {}): Promise<string> {
  const res = await server.inject({
    method: 'POST',
    url: '/api/v1/kam/initiatives',
    payload: { companyId, title: `Init ${randomUUID().slice(0, 6)}`, ...extra },
  });
  expect(res.statusCode).toBe(201);
  const id = res.json().id as string;
  createdInitiativeIds.push(id);
  return id;
}

async function transition(id: string, body: Record<string, unknown>) {
  return server.inject({
    method: 'POST',
    url: `/api/v1/kam/initiatives/${id}/transition`,
    payload: body,
  });
}

describe('KAM initiatives — state machine', () => {
  t('creates an initiative in the `initiative` stage', async () => {
    const id = await createInitiative();
    const res = await server.inject({ method: 'GET', url: `/api/v1/kam/initiatives/${id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      stage: 'initiative',
      companyId,
      convertedToOpportunityId: null,
    });
  });

  t('rejects an illegal stage skip (initiative → opportunity) with 409', async () => {
    const id = await createInitiative();
    const res = await transition(id, { toStage: 'opportunity' });
    expect(res.statusCode).toBe(409);
  });

  t('requires droppedReason to drop an initiative (400 without, 200 with)', async () => {
    const id = await createInitiative();
    expect((await transition(id, { toStage: 'dropped' })).statusCode).toBe(400);
    const ok = await transition(id, { toStage: 'dropped', droppedReason: 'no client interest' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().stage).toBe('dropped');
  });

  t(
    'advances initiative → lead → opportunity, minting an Opportunity + Handoff with companyId set',
    async () => {
      const id = await createInitiative({ estimatedValueMicros: 250_000_000 });
      expect((await transition(id, { toStage: 'lead' })).statusCode).toBe(200);
      const opp = await transition(id, { toStage: 'opportunity', opportunityName: 'KAM Test Opp' });
      expect(opp.statusCode).toBe(200);
      const detail = opp.json();
      expect(detail.stage).toBe('opportunity');
      expect(detail.convertedToOpportunityId).toBeTruthy();
      expect(detail.handoffId).toBeTruthy();
      createdOpportunityIds.push(detail.convertedToOpportunityId);

      // M1: the minted Opportunity must carry the initiative's companyId + value.
      const minted = await prisma.opportunity.findUnique({
        where: { id: detail.convertedToOpportunityId },
      });
      expect(minted?.companyId).toBe(companyId);
      expect(minted?.valueMicros).toBe(BigInt(250_000_000));
      // Handoff created, linked, draft, targeted at ABC OM.
      const handoff = await prisma.kamHandoff.findUnique({ where: { initiativeId: id } });
      expect(handoff).toMatchObject({
        companyId,
        opportunityId: minted!.id,
        status: 'draft',
        targetSystem: 'abc_om',
      });
    },
  );

  t(
    'opportunity is terminal — a further transition is 409 and mints no second opportunity (B2)',
    async () => {
      const id = await createInitiative();
      await transition(id, { toStage: 'lead' });
      const first = await transition(id, { toStage: 'opportunity' });
      expect(first.statusCode).toBe(200);
      createdOpportunityIds.push(first.json().convertedToOpportunityId);
      const before = await prisma.opportunity.count({ where: { orgId } });
      const second = await transition(id, { toStage: 'opportunity' });
      expect(second.statusCode).toBe(409);
      const after = await prisma.opportunity.count({ where: { orgId } });
      expect(after).toBe(before); // no duplicate mint
    },
  );

  t('rejects a cross-tenant company id (FK-graft) with 404 (B3)', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/kam/initiatives',
      payload: { companyId: otherCompanyId, title: 'cross-tenant graft' },
    });
    expect(res.statusCode).toBe(404);
  });

  t('lists initiatives for the account', async () => {
    await createInitiative();
    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/kam/initiatives?companyId=${companyId}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.length).toBeGreaterThanOrEqual(1);
  });
});

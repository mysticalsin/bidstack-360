import { randomUUID } from 'node:crypto';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@bidstack/db';
import { BID_CRITERIA, BID_TOTAL_WEIGHT, computeBidComposite } from '@bidstack/shared';
import { buildServer } from '../server.js';
import type { FastifyInstance } from 'fastify';

// Frontend and backend each kept a diverging criteria table before M8 —
// saving from the UI silently zeroed ~20 of 100 weight points. The shared
// registry is the single source of truth; these invariants guard it.
describe('shared bid criteria registry (no DB needed)', () => {
  it('weights sum to exactly 100', () => {
    expect(BID_CRITERIA.reduce((acc, c) => acc + c.weight, 0)).toBe(BID_TOTAL_WEIGHT);
  });

  it('composite always divides by the full weight, even partially rated', () => {
    // strategic_fit weight is 14: a lone 5/5 rating is 14/100, not 100/100.
    expect(computeBidComposite({ strategic_fit: 5 }).totalScore).toBe(14);
  });
});

// All ten registry criteria rated 4-5 → composite 85 → recommendation 'bid'.
const BID_WORTHY_CRITERIA = {
  strategic_fit: 5,
  relationship: 4,
  competitive: 5,
  tech_capability: 4,
  resource_avail: 4,
  solution_ready: 4,
  deal_size: 4,
  payment_terms: 4,
  financial_risk: 4,
  timeline_risk: 4,
};

// All 2s → composite 40 → recommendation 'no_bid' (below the 50 floor).
const BELOW_THRESHOLD_CRITERIA = Object.fromEntries(BID_CRITERIA.map((c) => [c.id, 2]));

// WHY plain describe (not describe.skipIf(!DATABASE_URL)): skipIf marks the
// whole suite "skipped" in vitest's report — a CI run without the env var set
// would go green with zero bid-score coverage. buildServer() below throws in
// beforeAll when the DB is unreachable, which fails the suite loudly instead.
describe('bid-score routes', () => {
  let server: FastifyInstance;
  const foreignOrgIds: string[] = [];
  const foreignOpportunityIds: string[] = [];

  beforeAll(async () => {
    server = await buildServer();
    await server.ready();
  });

  afterAll(async () => {
    if (foreignOpportunityIds.length > 0) {
      await prisma.bidScore.deleteMany({ where: { opportunityId: { in: foreignOpportunityIds } } });
      await prisma.opportunity.deleteMany({ where: { id: { in: foreignOpportunityIds } } });
    }
    if (foreignOrgIds.length > 0) {
      await prisma.org.deleteMany({ where: { id: { in: foreignOrgIds } } });
    }
    await server.close();
  });

  async function createForeignOpportunity() {
    const org = await prisma.org.create({
      data: {
        clerkOrg: `org_e2e_foreign_${randomUUID()}`,
        name: 'E2E Foreign Tenant',
      },
    });
    foreignOrgIds.push(org.id);

    const opp = await prisma.opportunity.create({
      data: {
        orgId: org.id,
        code: `XORG-${randomUUID().slice(0, 8)}`,
        customer: 'Cross Tenant Customer',
        name: 'Foreign tenant opportunity',
        stage: 's1_lead',
        valueMicros: 1_000_000n,
        probability: 10,
      },
    });
    foreignOpportunityIds.push(opp.id);
    return opp;
  }

  it('POST /api/v1/bid-scores creates a score', async () => {
    const list = await server.inject({ method: 'GET', url: '/api/v1/opportunities?limit=1' });
    expect(list.statusCode).toBe(200);
    const { items } = list.json();
    if (items.length === 0) {
      console.warn('[skip] no seeded opportunities');
      return;
    }
    const oppId = items[0].id;

    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/bid-scores',
      payload: {
        opportunityId: oppId,
        criteria: BID_WORTHY_CRITERIA,
        notes: 'Strong candidate',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.totalScore).toBeGreaterThan(0);
    expect(body.recommendation).toBe('bid');
    expect(body.opportunityId).toBe(oppId);
    expect(body.overrideJustification).toBeNull();
    expect(body.overriddenBy).toBeNull();
  });

  it('POST /api/v1/bid-scores rejects proceeding below threshold without a justification', async () => {
    const list = await server.inject({ method: 'GET', url: '/api/v1/opportunities?limit=1' });
    const { items } = list.json();
    if (items.length === 0) {
      console.warn('[skip] no seeded opportunities');
      return;
    }

    // decision=override with no override payload → 400, nothing persisted.
    const missing = await server.inject({
      method: 'POST',
      url: '/api/v1/bid-scores',
      payload: {
        opportunityId: items[0].id,
        criteria: BELOW_THRESHOLD_CRITERIA,
        decision: 'override',
      },
    });
    expect(missing.statusCode).toBe(400);

    // Justification under the 30-char mandatory floor → 400 (Zod).
    const tooShort = await server.inject({
      method: 'POST',
      url: '/api/v1/bid-scores',
      payload: {
        opportunityId: items[0].id,
        criteria: BELOW_THRESHOLD_CRITERIA,
        decision: 'override',
        override: { acknowledged: true, justification: 'too short' },
      },
    });
    expect(tooShort.statusCode).toBe(400);
  });

  it('POST /api/v1/bid-scores rejects an override when the recommendation is already bid', async () => {
    const list = await server.inject({ method: 'GET', url: '/api/v1/opportunities?limit=1' });
    const { items } = list.json();
    if (items.length === 0) {
      console.warn('[skip] no seeded opportunities');
      return;
    }

    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/bid-scores',
      payload: {
        opportunityId: items[0].id,
        criteria: BID_WORTHY_CRITERIA,
        decision: 'override',
        override: {
          acknowledged: true,
          justification: 'There is nothing to override here, the score is already a bid.',
        },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/v1/bid-scores with a valid override persists the justification and writes the director-visible audit row', async () => {
    const list = await server.inject({ method: 'GET', url: '/api/v1/opportunities?limit=1' });
    const { items } = list.json();
    if (items.length === 0) {
      console.warn('[skip] no seeded opportunities');
      return;
    }
    const justification =
      'Strategic market entry mandated by regional leadership despite weak score.';

    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/bid-scores',
      payload: {
        opportunityId: items[0].id,
        criteria: BELOW_THRESHOLD_CRITERIA,
        decision: 'override',
        override: { acknowledged: true, justification },
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.recommendation).toBe('no_bid');
    expect(body.overrideJustification).toBe(justification);
    expect(body.overriddenBy).toBeTruthy();

    // The override must be independently auditable — the latest endpoint
    // alone is not an audit trail.
    const auditRow = await prisma.auditLog.findFirst({
      where: { action: 'bid_score.override', targetType: 'bid_score', targetId: body.id },
    });
    expect(auditRow).not.toBeNull();
    expect((auditRow?.diff as { justification?: string })?.justification).toBe(justification);

    // And the latest-per-opportunity surface exposes it.
    const latest = await server.inject({
      method: 'GET',
      url: `/api/v1/bid-scores/${items[0].id}/latest`,
    });
    expect(latest.statusCode).toBe(200);
    expect(latest.json().overrideJustification).toBe(justification);
  });

  it('POST /api/v1/bid-scores rejects opportunities outside the caller org', async () => {
    const foreignOpp = await createForeignOpportunity();

    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/bid-scores',
      payload: {
        opportunityId: foreignOpp.id,
        criteria: BID_WORTHY_CRITERIA,
      },
    });

    expect(res.statusCode).toBe(404);
    const leaked = await prisma.bidScore.findFirst({ where: { opportunityId: foreignOpp.id } });
    expect(leaked).toBeNull();
  });

  it('POST /api/v1/bid-scores/:id/ai-calibrate rejects opportunities outside the caller org', async () => {
    const foreignOpp = await createForeignOpportunity();

    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/bid-scores/${foreignOpp.id}/ai-calibrate`,
    });

    expect(res.statusCode).toBe(404);
  });

  it('GET /api/v1/bid-scores/:opportunityId/latest returns latest score', async () => {
    const list = await server.inject({ method: 'GET', url: '/api/v1/opportunities?limit=1' });
    expect(list.statusCode).toBe(200);
    const { items } = list.json();
    if (items.length === 0) {
      console.warn('[skip] no seeded opportunities');
      return;
    }
    const oppId = items[0].id;

    await server.inject({
      method: 'POST',
      url: '/api/v1/bid-scores',
      payload: {
        opportunityId: oppId,
        criteria: BELOW_THRESHOLD_CRITERIA,
      },
    });

    const latest = await server.inject({
      method: 'GET',
      url: `/api/v1/bid-scores/${oppId}/latest`,
    });
    expect(latest.statusCode).toBe(200);
    const body = latest.json();
    expect(body.opportunityId).toBe(oppId);
    expect(body.version).toBeGreaterThanOrEqual(1);
  });

  it('POST /api/v1/bid-scores/:id/defend returns reasoning', async () => {
    const list = await server.inject({ method: 'GET', url: '/api/v1/opportunities?limit=1' });
    expect(list.statusCode).toBe(200);
    const { items } = list.json();
    if (items.length === 0) {
      console.warn('[skip] no seeded opportunities');
      return;
    }
    const oppId = items[0].id;

    const create = await server.inject({
      method: 'POST',
      url: '/api/v1/bid-scores',
      payload: {
        opportunityId: oppId,
        criteria: BID_WORTHY_CRITERIA,
      },
    });
    expect(create.statusCode).toBe(201);
    const score = create.json();

    const defend = await server.inject({
      method: 'POST',
      url: `/api/v1/bid-scores/${score.id}/defend`,
    });
    expect(defend.statusCode).toBe(200);
    const body = defend.json();
    expect(body.reasoning).toBeTruthy();
    expect(Array.isArray(body.sources)).toBe(true);
  });
});

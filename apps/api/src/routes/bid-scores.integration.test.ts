import { randomUUID } from 'node:crypto';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@bidstack/db';
import { buildServer } from '../server.js';
import type { FastifyInstance } from 'fastify';

describe.skipIf(!process.env.DATABASE_URL)('bid-score routes', () => {
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
        criteria: { fit: 4, relationship: 3, competitive: 5, tech_capability: 4, resource_avail: 3, solution_ready: 4, deal_size: 3, profitability: 4, timeline_fit: 3, risk_profile: 4 },
        notes: 'Strong candidate',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.totalScore).toBeGreaterThan(0);
    expect(body.recommendation).toBe('bid');
    expect(body.opportunityId).toBe(oppId);
  });

  it('POST /api/v1/bid-scores rejects opportunities outside the caller org', async () => {
    const foreignOpp = await createForeignOpportunity();

    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/bid-scores',
      payload: {
        opportunityId: foreignOpp.id,
        criteria: { fit: 4, relationship: 3, competitive: 5, tech_capability: 4, resource_avail: 3, solution_ready: 4, deal_size: 3, profitability: 4, timeline_fit: 3, risk_profile: 4 },
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
        criteria: { fit: 2, relationship: 2, competitive: 2, tech_capability: 2, resource_avail: 2, solution_ready: 2, deal_size: 2, profitability: 2, timeline_fit: 2, risk_profile: 2 },
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
        criteria: { fit: 4, relationship: 3, competitive: 5, tech_capability: 4, resource_avail: 3, solution_ready: 4, deal_size: 3, profitability: 4, timeline_fit: 3, risk_profile: 4 },
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

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@bidstack/db';
import { buildServer } from '../server.js';
import type { FastifyInstance } from 'fastify';

// WHY plain describe (not describe.skipIf(!DATABASE_URL)): skipIf marks the
// whole suite "skipped" in vitest's report — a CI run without the env var set
// would go green with zero proposal coverage. buildServer() below throws in
// beforeAll when the DB is unreachable, which fails the suite loudly instead.
describe('proposal routes', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await buildServer();
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it('POST /api/v1/proposals creates a proposal with sections', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/proposals',
      payload: { name: 'Test Proposal', dueDate: '2026-12-31' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe('Test Proposal');
    expect(body.status).toBe('draft');
    expect(body.sections).toBeDefined();
    expect(body.sections.length).toBeGreaterThan(0);
  });

  it('POST /api/v1/proposals rejects an opportunity outside the tenant scope', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/proposals',
      payload: {
        name: 'Bad Opportunity Proposal',
        opportunityId: '00000000-0000-0000-0000-000000000001',
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST /api/v1/proposals/:id/draft drafts a section', async () => {
    const create = await server.inject({
      method: 'POST',
      url: '/api/v1/proposals',
      payload: { name: 'Draft Test Proposal' },
    });
    expect(create.statusCode).toBe(201);
    const proposal = create.json();

    const section = proposal.sections.find((s: { key: string }) => s.key === 'executive_summary');
    expect(section).toBeDefined();

    const draft = await server.inject({
      method: 'POST',
      url: `/api/v1/proposals/${proposal.id}/draft`,
      payload: { sectionKey: 'executive_summary', context: 'Focus on digital transformation' },
    });
    expect(draft.statusCode).toBe(200);
    const body = draft.json();
    expect(body.sectionKey).toBe('executive_summary');
    expect(body.content).toBeTruthy();
    expect(body.wordCount).toBeGreaterThan(0);
    expect(Array.isArray(body.sources)).toBe(true);
  });

  it('RFP pipeline value leaves out a lost linked deal', async () => {
    // WHY: the analytics tile summed every linked deal, so a lost flag still
    // counted as pipeline. Won and lost proposals are not pipeline either.
    const before = await server.inject({
      method: 'GET',
      url: '/api/v1/proposals/admin/analytics',
    });
    expect(before.statusCode).toBe(200);
    const baseline = BigInt((before.json() as { totalValueMicros: string }).totalValueMicros);
    const org = await prisma.org.findUniqueOrThrow({ where: { clerkOrg: 'org_seed_mantu' } });
    const stamp = Date.now();
    const pipeline = await prisma.pipeline.create({
      data: { orgId: org.id, name: `RFP map ${stamp}` },
    });
    const lostStage = await prisma.pipelineStage.create({
      data: {
        orgId: org.id,
        pipelineId: pipeline.id,
        key: 'price_lost',
        name: 'Price lost',
        isLost: true,
      },
    });
    const openDeal = await prisma.opportunity.create({
      data: {
        orgId: org.id,
        code: `OP-RFP1-${stamp}`,
        customer: 'RFP Co',
        name: 'Open linked',
        stage: 's1_lead',
        valueMicros: 1_000_000n,
        probability: 10,
        intel: {},
      },
    });
    const lostDeal = await prisma.opportunity.create({
      data: {
        orgId: org.id,
        code: `OP-RFP2-${stamp}`,
        customer: 'RFP Co',
        name: 'Lost linked',
        stage: 's2_sent',
        pipelineStageId: lostStage.id,
        valueMicros: 9_000_000n,
        probability: 40,
        intel: {},
      },
    });
    const openProposal = await server.inject({
      method: 'POST',
      url: '/api/v1/proposals',
      payload: { name: `Open RFP ${stamp}`, opportunityId: openDeal.id },
    });
    const lostProposal = await server.inject({
      method: 'POST',
      url: '/api/v1/proposals',
      payload: { name: `Lost RFP ${stamp}`, opportunityId: lostDeal.id },
    });
    expect(openProposal.statusCode).toBe(201);
    expect(lostProposal.statusCode).toBe(201);
    try {
      const after = await server.inject({
        method: 'GET',
        url: '/api/v1/proposals/admin/analytics',
      });
      expect(after.statusCode).toBe(200);
      const total = BigInt((after.json() as { totalValueMicros: string }).totalValueMicros);
      expect(total - baseline).toBe(1_000_000n);
    } finally {
      const proposalIds = [openProposal.json().id, lostProposal.json().id].filter(Boolean);
      await prisma.proposalSection.deleteMany({ where: { proposalId: { in: proposalIds } } });
      await prisma.proposal.deleteMany({ where: { id: { in: proposalIds } } });
      await prisma.opportunity.deleteMany({ where: { id: { in: [openDeal.id, lostDeal.id] } } });
      await prisma.pipelineStage.deleteMany({ where: { pipelineId: pipeline.id } });
      await prisma.pipeline.delete({ where: { id: pipeline.id } });
    }
  });

  it('GET /api/v1/proposals lists proposals', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/proposals?limit=10',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(typeof body.total).toBe('number');
  });
});

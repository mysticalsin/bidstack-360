import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../server.js';
import type { FastifyInstance } from 'fastify';

describe.skipIf(!process.env.DATABASE_URL)('proposal routes', () => {
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

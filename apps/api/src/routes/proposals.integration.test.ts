import { randomUUID } from 'node:crypto';
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

  it('POST /api/v1/proposals/:id/draft never drafts into a soft-deleted section', async () => {
    const create = await server.inject({
      method: 'POST',
      url: '/api/v1/proposals',
      payload: { name: 'Deleted Section Proposal' },
    });
    const proposal = create.json<{ id: string; sections: Array<{ id: string; key: string }> }>();
    const pricing = proposal.sections.find((s) => s.key === 'pricing')!;
    await prisma.proposalSection.updateMany({
      where: { id: pricing.id },
      data: { deletedAt: new Date() },
    });

    const draft = await server.inject({
      method: 'POST',
      url: `/api/v1/proposals/${proposal.id}/draft`,
      payload: { sectionKey: 'pricing' },
    });
    expect(draft.statusCode).toBe(404);
    const row = await prisma.proposalSection.findFirstOrThrow({
      where: { id: pricing.id, deletedAt: { not: null } },
    });
    expect(row.aiDrafted).toBe(false);
  });

  it('GET /api/v1/proposals rejects out-of-range pagination', async () => {
    for (const qs of ['limit=0', 'limit=101', 'offset=-1']) {
      const res = await server.inject({ method: 'GET', url: `/api/v1/proposals?${qs}` });
      expect(res.statusCode, qs).toBe(400);
    }
  });

  it('POST /api/v1/proposals is 400 on an empty name', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/proposals',
      payload: { name: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/v1/proposals is 403 for a read-only role', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/proposals',
      headers: { 'x-bidstack-e2e-role': 'read-only' },
      payload: { name: 'Read only proposal' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('GET/PATCH/DELETE on another org proposal are 404', async () => {
    const org = await prisma.org.create({
      data: { clerkOrg: `org_prop_foreign_${randomUUID()}`, name: 'Foreign Proposal Tenant' },
    });
    try {
      const foreign = await prisma.proposal.create({
        data: { orgId: org.id, name: 'Foreign proposal' },
      });
      const get = await server.inject({ method: 'GET', url: `/api/v1/proposals/${foreign.id}` });
      expect(get.statusCode).toBe(404);
      const patch = await server.inject({
        method: 'PATCH',
        url: `/api/v1/proposals/${foreign.id}`,
        payload: { name: 'hijack' },
      });
      expect(patch.statusCode).toBe(404);
      const del = await server.inject({ method: 'DELETE', url: `/api/v1/proposals/${foreign.id}` });
      expect(del.statusCode).toBe(404);
      const row = await prisma.proposal.findUniqueOrThrow({ where: { id: foreign.id } });
      expect(row.name).toBe('Foreign proposal');
      expect(row.deletedAt).toBeNull();
    } finally {
      await prisma.org.deleteMany({ where: { id: org.id } });
    }
  });

  it('DELETE /api/v1/proposals/:id is idempotent: a retry is 404, not 500', async () => {
    const create = await server.inject({
      method: 'POST',
      url: '/api/v1/proposals',
      payload: { name: 'Delete twice' },
    });
    const { id } = create.json<{ id: string }>();
    const first = await server.inject({ method: 'DELETE', url: `/api/v1/proposals/${id}` });
    expect(first.statusCode).toBe(204);
    const retry = await server.inject({ method: 'DELETE', url: `/api/v1/proposals/${id}` });
    expect(retry.statusCode).toBe(404);
  });
});

// Integration tests for the references routes.
// Covers CRUD, input-validation max constraints, and cross-tenant isolation.

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';

describe.skipIf(!process.env.DATABASE_URL)('references routes', () => {
  let server: Awaited<ReturnType<typeof buildServer>>;
  const createdReferenceIds: string[] = [];
  const foreignOrgIds: string[] = [];

  beforeAll(async () => {
    server = await buildServer();
    await server.ready();
  });

  afterAll(async () => {
    if (createdReferenceIds.length > 0) {
      await prisma.reference.deleteMany({ where: { id: { in: createdReferenceIds } } });
    }
    if (foreignOrgIds.length > 0) {
      await prisma.org.deleteMany({ where: { id: { in: foreignOrgIds } } });
    }
    await server.close();
  });

  async function createForeignReference() {
    const org = await prisma.org.create({
      data: {
        clerkOrg: `org_ref_foreign_${randomUUID()}`,
        name: 'E2E Foreign Ref Tenant',
      },
    });
    foreignOrgIds.push(org.id);

    return prisma.reference.create({
      data: {
        orgId: org.id,
        title: `Foreign reference ${randomUUID().slice(0, 8)}`,
        tags: [],
        usageCount: 0,
      },
    });
  }

  // ── List ───────────────────────────────────────────────────────────────────

  it('GET /api/v1/references returns 200 with items array', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/references' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
  });

  // ── Input validation: query params ─────────────────────────────────────────

  it('GET /api/v1/references rejects search longer than 200 chars', async () => {
    const long = 'a'.repeat(201);
    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/references?search=${encodeURIComponent(long)}`,
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/v1/references rejects industry longer than 100 chars', async () => {
    const long = 'b'.repeat(101);
    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/references?industry=${encodeURIComponent(long)}`,
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/v1/references rejects tag longer than 100 chars', async () => {
    const long = 'c'.repeat(101);
    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/references?tag=${encodeURIComponent(long)}`,
    });
    expect(res.statusCode).toBe(400);
  });

  // ── Create ─────────────────────────────────────────────────────────────────

  it('POST /api/v1/references creates a reference', async () => {
    const title = `Test Reference ${randomUUID().slice(0, 8)}`;
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/references',
      payload: {
        title,
        description: 'Integration test reference',
        industry: 'Technology',
        tags: ['cloud', 'enterprise'],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.title).toBe(title);
    expect(body.industry).toBe('Technology');
    expect(body.tags).toEqual(['cloud', 'enterprise']);
    expect(body.usageCount).toBe(0);
    createdReferenceIds.push(body.id);
  });

  // ── Input validation: POST body ────────────────────────────────────────────

  it('POST /api/v1/references rejects empty title', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/references',
      payload: { title: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/v1/references rejects title longer than 255 chars', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/references',
      payload: { title: 'x'.repeat(256) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/v1/references rejects industry longer than 100 chars', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/references',
      payload: { title: 'Valid title', industry: 'd'.repeat(101) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/v1/references rejects more than 20 tags', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/references',
      payload: {
        title: 'Valid title',
        tags: Array.from({ length: 21 }, (_, i) => `tag${i}`),
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/v1/references rejects invalid contactEmail', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/references',
      payload: { title: 'Valid title', contactEmail: 'not-an-email' },
    });
    expect(res.statusCode).toBe(400);
  });

  // ── Use (increment usage) ──────────────────────────────────────────────────

  it('POST /api/v1/references/:id/use increments usageCount', async () => {
    // Create a reference to use
    const create = await server.inject({
      method: 'POST',
      url: '/api/v1/references',
      payload: { title: `Usage test ${randomUUID().slice(0, 8)}`, tags: [] },
    });
    expect(create.statusCode).toBe(201);
    const { id, usageCount: before } = create.json();
    createdReferenceIds.push(id);

    const use = await server.inject({
      method: 'POST',
      url: `/api/v1/references/${id}/use`,
    });
    expect(use.statusCode).toBe(200);
    const body = use.json();
    expect(body.usageCount).toBe(before + 1);
    expect(body.lastUsedAt).not.toBeNull();
  });

  it('POST /api/v1/references/:id/use returns 404 for unknown id', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/references/${randomUUID()}/use`,
    });
    expect(res.statusCode).toBe(404);
  });

  // ── Cross-tenant isolation ─────────────────────────────────────────────────

  it('DELETE /api/v1/references/:id returns 404 for a foreign-org reference', async () => {
    const foreignRef = await createForeignReference();

    const res = await server.inject({
      method: 'DELETE',
      url: `/api/v1/references/${foreignRef.id}`,
    });

    // WHY: 404 (not 403) — we don't reveal cross-tenant resource existence
    expect(res.statusCode).toBe(404);

    // Confirm the record was NOT soft-deleted in the foreign org
    const still = await prisma.reference.findUnique({ where: { id: foreignRef.id } });
    expect(still?.deletedAt).toBeNull();
  });

  it('PATCH /api/v1/references/:id returns 404 for a foreign-org reference', async () => {
    const foreignRef = await createForeignReference();

    const res = await server.inject({
      method: 'PATCH',
      url: `/api/v1/references/${foreignRef.id}`,
      payload: { title: 'Hijacked title' },
    });

    expect(res.statusCode).toBe(404);

    const still = await prisma.reference.findUnique({ where: { id: foreignRef.id } });
    expect(still?.title).not.toBe('Hijacked title');
  });

  it('POST /api/v1/references/:id/use returns 404 for a foreign-org reference', async () => {
    const foreignRef = await createForeignReference();

    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/references/${foreignRef.id}/use`,
    });

    expect(res.statusCode).toBe(404);

    const still = await prisma.reference.findUnique({ where: { id: foreignRef.id } });
    expect(still?.usageCount).toBe(0);
  });
});

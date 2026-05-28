// Integration tests for migration routes.
//
// Skipped unless DATABASE_URL is set (CI + local dev with DB).
// Does NOT require Redis — destructive operations are tested directly;
// start-csv (which enqueues BullMQ jobs) is not covered here to avoid
// needing the queue infrastructure in the test environment.
//
// Why we create MigrationJob rows via Prisma instead of POST /start-csv:
//   start-csv requires a live Redis connection to write row chunks and
//   enqueue BullMQ tasks. Testing cancel/undo via direct Prisma inserts
//   keeps the test hermetic and fast while still exercising the real HTTP
//   handler logic, auth scoping, and Prisma mutations.

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../server.js';

describe.skipIf(!process.env.DATABASE_URL)('migration routes', () => {
  let server: FastifyInstance;
  let seedOrgId: string;
  let seedUserId: string;

  // IDs created during tests — cleaned up in afterAll to keep DB tidy.
  const createdJobIds: string[] = [];
  const createdCompanyIds: string[] = [];
  const createdLeadIds: string[] = [];
  const foreignOrgIds: string[] = [];

  beforeAll(async () => {
    server = await buildServer();
    await server.ready();

    // Resolve the seed org that the stub auth always resolves to.
    // WHY: the auth stub in auth.ts always resolves org_seed_mantu + first
    //      user. We need the DB IDs to create test fixtures in the right org.
    const org = await prisma.org.findFirstOrThrow({
      where: { clerkOrg: 'org_seed_mantu' },
    });
    seedOrgId = org.id;

    const user = await prisma.user.findFirstOrThrow({ where: { orgId: seedOrgId } });
    seedUserId = user.id;
  });

  afterAll(async () => {
    // Clean up in FK-safe order: child records first.
    if (createdLeadIds.length > 0) {
      await prisma.lead.deleteMany({ where: { id: { in: createdLeadIds } } });
    }
    if (createdCompanyIds.length > 0) {
      await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
    }
    if (createdJobIds.length > 0) {
      await prisma.migrationJob.deleteMany({ where: { id: { in: createdJobIds } } });
    }
    if (foreignOrgIds.length > 0) {
      // Cascade delete handles jobs + any child records in the foreign orgs.
      await prisma.org.deleteMany({ where: { id: { in: foreignOrgIds } } });
    }
    await server.close();
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  async function createJob(
    overrides: Partial<{
      orgId: string;
      status: 'PENDING' | 'RUNNING' | 'COMPLETE' | 'CANCELLED' | 'FAILED';
      undoableUntil: Date | null;
    }> = {},
  ) {
    const job = await prisma.migrationJob.create({
      data: {
        orgId: overrides.orgId ?? seedOrgId,
        userId: seedUserId,
        source: 'CSV',
        status: overrides.status ?? 'PENDING',
        totalRows: 10,
        processedRows: overrides.status === 'COMPLETE' ? 10 : 0,
        errorRows: 0,
        undoableUntil: overrides.undoableUntil !== undefined ? overrides.undoableUntil : null,
      },
    });

    // Only track own-org jobs in createdJobIds; foreign-org jobs get cleaned
    // up via org cascade delete.
    const effectiveOrgId = overrides.orgId ?? seedOrgId;
    if (effectiveOrgId === seedOrgId) {
      createdJobIds.push(job.id);
    }

    return job;
  }

  async function createForeignOrg() {
    const org = await prisma.org.create({
      data: {
        clerkOrg: `org_e2e_migration_${randomUUID()}`,
        name: 'E2E Migration Foreign Tenant',
      },
    });
    foreignOrgIds.push(org.id);
    return org;
  }

  // Creates a Company tagged for migration undo testing.
  async function createMigrationCompany(jobId: string) {
    const company = await prisma.company.create({
      data: {
        orgId: seedOrgId,
        name: `Migration Test Co ${randomUUID().slice(0, 8)}`,
        source: `migration:${jobId}`,
      },
    });
    createdCompanyIds.push(company.id);
    return company;
  }

  // Creates a Lead tagged for migration undo testing.
  async function createMigrationLead(jobId: string) {
    const lead = await prisma.lead.create({
      data: {
        orgId: seedOrgId,
        firstName: 'Migration',
        lastName: `Lead ${randomUUID().slice(0, 8)}`,
        companyName: 'Migration Test Corp',
        source: `migration:${jobId}`,
      },
    });
    createdLeadIds.push(lead.id);
    return lead;
  }

  // ── GET /api/v1/migrations ────────────────────────────────────────────────

  it('GET /api/v1/migrations returns only own-org jobs', async () => {
    const ownJob = await createJob({ status: 'PENDING' });
    const foreignOrg = await createForeignOrg();
    // Create a job in a different org — must never appear in the caller's list.
    await prisma.migrationJob.create({
      data: {
        orgId: foreignOrg.id,
        userId: seedUserId,
        source: 'CSV',
        status: 'RUNNING',
        totalRows: 5,
        processedRows: 2,
        errorRows: 0,
      },
    });

    const res = await server.inject({ method: 'GET', url: '/api/v1/migrations' });
    expect(res.statusCode).toBe(200);

    const { items } = res.json<{ items: Array<{ id: string; orgId: string }> }>();
    const ids = items.map((j) => j.id);

    // WHY: cross-tenant isolation — callers must not observe other orgs' data.
    expect(ids).toContain(ownJob.id);
    expect(items.every((j) => j.orgId === seedOrgId)).toBe(true);
  });

  it('GET /api/v1/migrations?status=RUNNING filters by status', async () => {
    await createJob({ status: 'PENDING' });
    const runningJob = await createJob({ status: 'RUNNING' });

    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/migrations?status=RUNNING',
    });
    expect(res.statusCode).toBe(200);

    const { items } = res.json<{ items: Array<{ id: string; status: string }> }>();
    expect(items.every((j) => j.status === 'RUNNING')).toBe(true);
    expect(items.some((j) => j.id === runningJob.id)).toBe(true);
  });

  // ── GET /api/v1/migrations/:id ────────────────────────────────────────────

  it('GET /api/v1/migrations/:id returns 200 for own-org job', async () => {
    const job = await createJob({ status: 'RUNNING' });

    const res = await server.inject({ method: 'GET', url: `/api/v1/migrations/${job.id}` });
    expect(res.statusCode).toBe(200);

    const body = res.json<{ id: string; status: string }>();
    expect(body.id).toBe(job.id);
    expect(body.status).toBe('RUNNING');
  });

  it('GET /api/v1/migrations/:id returns 404 for cross-org job', async () => {
    const foreignOrg = await createForeignOrg();
    const foreignJob = await createJob({ orgId: foreignOrg.id });

    // The auth stub always resolves seedOrg — attempting to fetch a foreign
    // job must return 404, not the job data.
    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/migrations/${foreignJob.id}`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /api/v1/migrations/:id returns 404 for non-existent UUID', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/migrations/${randomUUID()}`,
    });
    expect(res.statusCode).toBe(404);
  });

  // ── DELETE /api/v1/migrations/:id/cancel ─────────────────────────────────

  it('DELETE /migrations/:id/cancel transitions PENDING → CANCELLED', async () => {
    const job = await createJob({ status: 'PENDING' });

    const res = await server.inject({
      method: 'DELETE',
      url: `/api/v1/migrations/${job.id}/cancel`,
    });
    expect(res.statusCode).toBe(200);

    const body = res.json<{ id: string; status: string }>();
    expect(body.status).toBe('CANCELLED');
    expect(body.id).toBe(job.id);
  });

  it('DELETE /migrations/:id/cancel transitions RUNNING → CANCELLED', async () => {
    const job = await createJob({ status: 'RUNNING' });

    const res = await server.inject({
      method: 'DELETE',
      url: `/api/v1/migrations/${job.id}/cancel`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ status: string }>().status).toBe('CANCELLED');
  });

  it('DELETE /migrations/:id/cancel returns 409 for already-COMPLETE job', async () => {
    const job = await createJob({ status: 'COMPLETE' });

    const res = await server.inject({
      method: 'DELETE',
      url: `/api/v1/migrations/${job.id}/cancel`,
    });
    // WHY: cancelling a finished job is a client logic error, not a server error.
    expect(res.statusCode).toBe(409);
  });

  it('DELETE /migrations/:id/cancel returns 409 for already-CANCELLED job', async () => {
    const job = await createJob({ status: 'CANCELLED' });

    const res = await server.inject({
      method: 'DELETE',
      url: `/api/v1/migrations/${job.id}/cancel`,
    });
    expect(res.statusCode).toBe(409);
  });

  it('DELETE /migrations/:id/cancel returns 409 for FAILED job', async () => {
    const job = await createJob({ status: 'FAILED' });

    const res = await server.inject({
      method: 'DELETE',
      url: `/api/v1/migrations/${job.id}/cancel`,
    });
    expect(res.statusCode).toBe(409);
  });

  it('DELETE /migrations/:id/cancel returns 404 for cross-org job', async () => {
    const foreignOrg = await createForeignOrg();
    const foreignJob = await createJob({ orgId: foreignOrg.id, status: 'RUNNING' });

    // The handler does orgId-scoped lookup first — foreign job appears as 404.
    const res = await server.inject({
      method: 'DELETE',
      url: `/api/v1/migrations/${foreignJob.id}/cancel`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE /migrations/:id/cancel returns 404 for non-existent UUID', async () => {
    const res = await server.inject({
      method: 'DELETE',
      url: `/api/v1/migrations/${randomUUID()}/cancel`,
    });
    expect(res.statusCode).toBe(404);
  });

  // ── DELETE /api/v1/migrations/:id/undo ───────────────────────────────────

  it('DELETE /migrations/:id/undo deletes tagged records and returns deletedCount', async () => {
    const undoableUntil = new Date(Date.now() + 24 * 60 * 60 * 1000); // +24 h
    const job = await createJob({ status: 'COMPLETE', undoableUntil });

    // Seed the rows the undo operation should remove.
    const company = await createMigrationCompany(job.id);
    const lead = await createMigrationLead(job.id);

    const res = await server.inject({
      method: 'DELETE',
      url: `/api/v1/migrations/${job.id}/undo`,
    });
    expect(res.statusCode).toBe(200);

    const body = res.json<{ message: string; deletedCount: number }>();
    // WHY: deletedCount must reflect the exact rows removed so callers can
    //      confirm the undo worked without a follow-up query.
    expect(body.deletedCount).toBe(2); // 1 company + 1 lead

    // Verify the rows are actually gone from the database.
    const companyRow = await prisma.company.findUnique({ where: { id: company.id } });
    expect(companyRow).toBeNull();
    const leadRow = await prisma.lead.findUnique({ where: { id: lead.id } });
    expect(leadRow).toBeNull();

    // Remove from cleanup lists — already deleted by undo.
    createdCompanyIds.splice(createdCompanyIds.indexOf(company.id), 1);
    createdLeadIds.splice(createdLeadIds.indexOf(lead.id), 1);
  });

  it('DELETE /migrations/:id/undo returns 409 when job is not COMPLETE', async () => {
    const job = await createJob({ status: 'RUNNING' });

    const res = await server.inject({
      method: 'DELETE',
      url: `/api/v1/migrations/${job.id}/undo`,
    });
    // WHY: undo only makes sense after all rows have been committed; attempting
    //      it mid-run would produce unpredictable partial-delete results.
    expect(res.statusCode).toBe(409);
  });

  it('DELETE /migrations/:id/undo returns 410 when undo window is expired', async () => {
    // undoableUntil in the past — window has closed.
    const undoableUntil = new Date(Date.now() - 1000); // 1 s ago
    const job = await createJob({ status: 'COMPLETE', undoableUntil });

    const res = await server.inject({
      method: 'DELETE',
      url: `/api/v1/migrations/${job.id}/undo`,
    });
    // WHY: 410 Gone communicates that the resource existed but the capability
    //      is permanently gone — distinct from 409 (wrong state) and 404 (not found).
    expect(res.statusCode).toBe(410);
  });

  it('DELETE /migrations/:id/undo returns 410 when undoableUntil is null (window never set)', async () => {
    const job = await createJob({ status: 'COMPLETE', undoableUntil: null });

    const res = await server.inject({
      method: 'DELETE',
      url: `/api/v1/migrations/${job.id}/undo`,
    });
    // null undoableUntil is treated the same as expired — undo was never enabled.
    expect(res.statusCode).toBe(410);
  });

  it('DELETE /migrations/:id/undo returns 404 for cross-org job', async () => {
    const foreignOrg = await createForeignOrg();
    const undoableUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const foreignJob = await createJob({
      orgId: foreignOrg.id,
      status: 'COMPLETE',
      undoableUntil,
    });

    const res = await server.inject({
      method: 'DELETE',
      url: `/api/v1/migrations/${foreignJob.id}/undo`,
    });
    // WHY: cross-tenant isolation — a caller must not be able to undo another
    //      org's import, even if they somehow know the job UUID.
    expect(res.statusCode).toBe(404);
  });

  it('DELETE /migrations/:id/undo returns 404 for non-existent UUID', async () => {
    const res = await server.inject({
      method: 'DELETE',
      url: `/api/v1/migrations/${randomUUID()}/undo`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE /migrations/:id/undo only deletes own-org tagged rows (cross-org guard)', async () => {
    // Create job in seed org with undo window open.
    const undoableUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const job = await createJob({ status: 'COMPLETE', undoableUntil });

    // Create a company in a FOREIGN org that coincidentally carries the same
    // sourceTag format — undo must NOT delete it.
    const foreignOrg = await createForeignOrg();
    const foreignCompany = await prisma.company.create({
      data: {
        orgId: foreignOrg.id,
        name: `Foreign Migration Co ${randomUUID().slice(0, 8)}`,
        source: `migration:${job.id}`,
      },
    });

    const res = await server.inject({
      method: 'DELETE',
      url: `/api/v1/migrations/${job.id}/undo`,
    });
    expect(res.statusCode).toBe(200);

    // deletedCount should be 0 — no rows in seed org carry this tag.
    const body = res.json<{ deletedCount: number }>();
    expect(body.deletedCount).toBe(0);

    // Foreign company must survive.
    const surviving = await prisma.company.findUnique({ where: { id: foreignCompany.id } });
    expect(surviving).not.toBeNull();

    // Clean up the foreign company (the org cascade won't fire until afterAll).
    await prisma.company.delete({ where: { id: foreignCompany.id } });
  });
});

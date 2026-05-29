// Integration tests — GET /api/v1/migrations + GET /api/v1/migrations/:id
//
// Key invariants verified:
//   - GET /api/v1/migrations returns only own-org jobs (cross-tenant isolation)
//   - GET /api/v1/migrations?status= filters by status
//   - GET /api/v1/migrations/:id returns 200 with correct shape for own-org job
//   - GET /api/v1/migrations/:id returns 404 for cross-org job (no existence leak)
//   - GET /api/v1/migrations/:id returns 404 for non-existent UUID

import { randomUUID } from 'node:crypto';
import { describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { makeMigrationsTestContext } from './migrations.test-helpers.js';

const { ctx, skipIfNoDb, createJob, createForeignOrg } = makeMigrationsTestContext();

describe('GET /api/v1/migrations', () => {
  skipIfNoDb('returns only own-org jobs', async () => {
    const ownJob = await createJob({ status: 'PENDING' });
    const foreignOrg = await createForeignOrg();
    // Create a job in a different org — must never appear in the caller's list.
    await prisma.migrationJob.create({
      data: {
        orgId: foreignOrg.id,
        userId: ctx.seedUserId!,
        source: 'CSV',
        status: 'RUNNING',
        totalRows: 5,
        processedRows: 2,
        errorRows: 0,
      },
    });

    const res = await ctx.server.inject({ method: 'GET', url: '/api/v1/migrations' });
    expect(res.statusCode).toBe(200);

    const { items } = res.json<{ items: Array<{ id: string; orgId: string }> }>();
    const ids = items.map((j) => j.id);

    // WHY: cross-tenant isolation — callers must not observe other orgs' data.
    expect(ids).toContain(ownJob.id);
    expect(items.every((j) => j.orgId === ctx.seedOrgId)).toBe(true);
  });

  skipIfNoDb('?status=RUNNING filters by status', async () => {
    await createJob({ status: 'PENDING' });
    const runningJob = await createJob({ status: 'RUNNING' });

    const res = await ctx.server.inject({
      method: 'GET',
      url: '/api/v1/migrations?status=RUNNING',
    });
    expect(res.statusCode).toBe(200);

    const { items } = res.json<{ items: Array<{ id: string; status: string }> }>();
    expect(items.every((j) => j.status === 'RUNNING')).toBe(true);
    expect(items.some((j) => j.id === runningJob.id)).toBe(true);
  });
});

describe('GET /api/v1/migrations/:id', () => {
  skipIfNoDb('returns 200 with correct shape for own-org job', async () => {
    const job = await createJob({ status: 'RUNNING' });

    const res = await ctx.server.inject({ method: 'GET', url: `/api/v1/migrations/${job.id}` });
    expect(res.statusCode).toBe(200);

    const body = res.json<{ id: string; status: string }>();
    expect(body.id).toBe(job.id);
    expect(body.status).toBe('RUNNING');
  });

  skipIfNoDb('returns 404 for cross-org job', async () => {
    const foreignOrg = await createForeignOrg();
    const foreignJob = await createJob({ orgId: foreignOrg.id });

    // The auth stub always resolves seedOrg — attempting to fetch a foreign
    // job must return 404, not the job data.
    const res = await ctx.server.inject({
      method: 'GET',
      url: `/api/v1/migrations/${foreignJob.id}`,
    });
    expect(res.statusCode).toBe(404);
  });

  skipIfNoDb('returns 404 for non-existent UUID', async () => {
    const res = await ctx.server.inject({
      method: 'GET',
      url: `/api/v1/migrations/${randomUUID()}`,
    });
    expect(res.statusCode).toBe(404);
  });
});

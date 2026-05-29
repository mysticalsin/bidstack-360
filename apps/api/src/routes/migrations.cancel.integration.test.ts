// Integration tests — DELETE /api/v1/migrations/:id/cancel
//
// Key invariants verified:
//   - PENDING → CANCELLED (200 with updated status)
//   - RUNNING → CANCELLED (200)
//   - 409 for already-COMPLETE job (idempotency guard)
//   - 409 for already-CANCELLED job
//   - 409 for FAILED job
//   - 404 for cross-org job (orgId-scoped lookup)
//   - 404 for non-existent UUID

import { randomUUID } from 'node:crypto';
import { describe, expect } from 'vitest';

import { makeMigrationsTestContext } from './migrations.test-helpers.js';

const { ctx, skipIfNoDb, createJob, createForeignOrg } = makeMigrationsTestContext();

describe('DELETE /api/v1/migrations/:id/cancel', () => {
  skipIfNoDb('transitions PENDING → CANCELLED', async () => {
    const job = await createJob({ status: 'PENDING' });

    const res = await ctx.server.inject({
      method: 'DELETE',
      url: `/api/v1/migrations/${job.id}/cancel`,
    });
    expect(res.statusCode).toBe(200);

    const body = res.json<{ id: string; status: string }>();
    expect(body.status).toBe('CANCELLED');
    expect(body.id).toBe(job.id);
  });

  skipIfNoDb('transitions RUNNING → CANCELLED', async () => {
    const job = await createJob({ status: 'RUNNING' });

    const res = await ctx.server.inject({
      method: 'DELETE',
      url: `/api/v1/migrations/${job.id}/cancel`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ status: string }>().status).toBe('CANCELLED');
  });

  skipIfNoDb('returns 409 for already-COMPLETE job', async () => {
    const job = await createJob({ status: 'COMPLETE' });

    const res = await ctx.server.inject({
      method: 'DELETE',
      url: `/api/v1/migrations/${job.id}/cancel`,
    });
    // WHY: cancelling a finished job is a client logic error, not a server error.
    expect(res.statusCode).toBe(409);
  });

  skipIfNoDb('returns 409 for already-CANCELLED job', async () => {
    const job = await createJob({ status: 'CANCELLED' });

    const res = await ctx.server.inject({
      method: 'DELETE',
      url: `/api/v1/migrations/${job.id}/cancel`,
    });
    expect(res.statusCode).toBe(409);
  });

  skipIfNoDb('returns 409 for FAILED job', async () => {
    const job = await createJob({ status: 'FAILED' });

    const res = await ctx.server.inject({
      method: 'DELETE',
      url: `/api/v1/migrations/${job.id}/cancel`,
    });
    expect(res.statusCode).toBe(409);
  });

  skipIfNoDb('returns 404 for cross-org job', async () => {
    const foreignOrg = await createForeignOrg();
    const foreignJob = await createJob({ orgId: foreignOrg.id, status: 'RUNNING' });

    // The handler does orgId-scoped lookup first — foreign job appears as 404.
    const res = await ctx.server.inject({
      method: 'DELETE',
      url: `/api/v1/migrations/${foreignJob.id}/cancel`,
    });
    expect(res.statusCode).toBe(404);
  });

  skipIfNoDb('returns 404 for non-existent UUID', async () => {
    const res = await ctx.server.inject({
      method: 'DELETE',
      url: `/api/v1/migrations/${randomUUID()}/cancel`,
    });
    expect(res.statusCode).toBe(404);
  });
});

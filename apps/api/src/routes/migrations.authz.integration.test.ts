// WHY: cancel and retry change tenant data in bulk. A caller without
// settings:write is refused, and another tenant's job id is a 404.

import { randomUUID } from 'node:crypto';
import { describe, expect } from 'vitest';

import { makeMigrationsTestContext } from './migrations.test-helpers.js';

const { ctx, skipIfNoDb, createJob, createForeignOrg } = makeMigrationsTestContext();

describe('migration cancel and retry authz', () => {
  skipIfNoDb('cancel returns 403 without settings:write', async () => {
    process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
    const job = await createJob({ status: 'RUNNING' });
    const res = await ctx.server.inject({
      method: 'DELETE',
      url: `/api/v1/migrations/${job.id}/cancel`,
      headers: { 'x-bidstack-e2e-role': 'read-only' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ message: string }>().message).not.toMatch(/disabled/i);
  });

  skipIfNoDb('cancel returns 404 for a job in another org', async () => {
    const foreignOrg = await createForeignOrg();
    const foreignJob = await createJob({ orgId: foreignOrg.id, status: 'RUNNING' });
    const res = await ctx.server.inject({
      method: 'DELETE',
      url: `/api/v1/migrations/${foreignJob.id}/cancel`,
    });
    expect(res.statusCode).toBe(404);
  });

  skipIfNoDb('retry returns 403 without settings:write', async () => {
    process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
    const job = await createJob({ status: 'FAILED' });
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/api/v1/migrations/${job.id}/retry`,
      headers: { 'x-bidstack-e2e-role': 'read-only' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ message: string }>().message).not.toMatch(/disabled/i);
  });

  skipIfNoDb('retry returns 404 for a job in another org', async () => {
    const foreignOrg = await createForeignOrg();
    const foreignJob = await createJob({ orgId: foreignOrg.id, status: 'FAILED' });
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/api/v1/migrations/${foreignJob.id}/retry`,
    });
    expect(res.statusCode).toBe(404);
  });

  skipIfNoDb('retry returns 404 for an unknown id', async () => {
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/api/v1/migrations/${randomUUID()}/retry`,
    });
    expect(res.statusCode).toBe(404);
  });
});

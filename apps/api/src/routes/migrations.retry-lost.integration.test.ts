// WHY: two retries of one failed job must not both queue chunks. The loser
// is a 409 with a stable code, not a sentence the client has to match.

import { Queue } from 'bullmq';
import { describe, expect, vi } from 'vitest';

import { prisma } from '@bidstack/db';

import { makeMigrationsTestContext } from './migrations.test-helpers.js';

const { ctx, skipIfNoDb, createJob } = makeMigrationsTestContext();

describe('parallel migration retry', () => {
  skipIfNoDb('two parallel retries queue one attempt and return RETRY_LOST', async () => {
    const job = await createJob({ status: 'FAILED' });
    await prisma.migrationJob.update({
      where: { id: job.id },
      data: {
        meta: {
          entityType: 'company',
          dedupStrategy: 'skip',
          mappings: { Name: 'company.name' },
          attemptId: 'attempt-failed',
        },
      },
    });
    await ctx.server.redis.set(
      `migration:${job.id}:company:rows`,
      JSON.stringify([{ Name: 'Northwind Traders' }]),
      'EX',
      3600,
    );
    const addBulk = vi.spyOn(Queue.prototype, 'addBulk').mockResolvedValue([{ id: 'chunk' }] as never);
    try {
      const [left, right] = await Promise.all([
        ctx.server.inject({ method: 'POST', url: `/api/v1/migrations/${job.id}/retry` }),
        ctx.server.inject({ method: 'POST', url: `/api/v1/migrations/${job.id}/retry` }),
      ]);
      const statuses = [left.statusCode, right.statusCode].sort();
      expect(statuses).toEqual([200, 409]);
      const lost = left.statusCode === 409 ? left : right;
      expect(lost.json<{ code?: string }>().code).toBe('RETRY_LOST');
      expect(addBulk).toHaveBeenCalledTimes(1);
    } finally {
      addBulk.mockRestore();
      await ctx.server.redis.del(`migration:${job.id}:company:rows`);
    }
  });

  skipIfNoDb('a retry that finds the job already running is RETRY_LOST', async () => {
    // WHY: the early status check answered a plain 409. The wizard painted
    // that as a red failure on a job the other retry had already started.
    const job = await createJob({ status: 'RUNNING' });
    await prisma.migrationJob.update({
      where: { id: job.id },
      data: {
        meta: {
          entityType: 'company',
          dedupStrategy: 'skip',
          mappings: { Name: 'company.name' },
          attemptId: 'attempt-running',
        },
      },
    });
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/api/v1/migrations/${job.id}/retry`,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ code?: string; message?: string }>().code).toBe('RETRY_LOST');
  });
});

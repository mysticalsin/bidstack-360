// WHY: a cancel that arrives after every row is committed must not flip a
// finished import to CANCELLED. The rows are already in. The job stays
// COMPLETE and the response says so.

import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { makeMigrationsTestContext } from './migrations.test-helpers.js';

const { ctx, skipIfNoDb, createJob } = makeMigrationsTestContext();

skipIfNoDb('a cancel after the rows are in leaves the job complete', async () => {
  const attemptId = randomUUID();
  const job = await createJob({ status: 'RUNNING' });
  await prisma.migrationJob.update({
    where: { id: job.id },
    data: {
      totalRows: 1,
      processedRows: 1,
      errorRows: 0,
      meta: { entityType: 'companies', attemptId },
    },
  });
  const res = await ctx.server.inject({
    method: 'DELETE',
    url: `/api/v1/migrations/${job.id}/cancel`,
  });
  expect(res.statusCode).toBe(409);
  expect(res.json<{ code?: string }>().code).toBe('IMPORT_FINISHED');
  const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
  expect(stored.status).toBe('COMPLETE');
});

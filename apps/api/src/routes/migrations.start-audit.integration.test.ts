// WHY: cancel and retry bind marks to an attempt. The start audit used to
// omit attemptId, so a later mark could not be traced to the attempt the
// claim stored. The diff stays free of row data.

import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { makeMigrationsTestContext } from './migrations.test-helpers.js';

const { ctx } = makeMigrationsTestContext();

it('the start audit records the same attemptId the claim stores', async () => {
  if (!ctx.dbReachable || !ctx.seedOrgId) {
    throw new Error('[skip] start audit — DATABASE_URL not reachable');
  }
  const name = `Audit ${randomUUID().slice(0, 8)}`;
  const res = await ctx.server.inject({
    method: 'POST',
    url: '/api/v1/migrations/start-csv',
    payload: {
      source: 'CSV',
      entityType: 'company',
      rows: [{ name }],
      mappings: { name: 'company.name' },
    },
  });
  expect(res.statusCode).toBe(201);
  const id = res.json<{ id: string }>().id;
  ctx.cleanup.jobIds.push(id);
  const job = await prisma.migrationJob.findUniqueOrThrow({ where: { id } });
  const audit = await prisma.auditLog.findFirst({
    where: { targetId: id, action: 'migration.start', targetType: 'MigrationJob' },
    orderBy: { at: 'desc' },
  });
  const diff = audit?.diff as { attemptId?: string } | null;
  expect(diff?.attemptId).toBe((job.meta as { attemptId?: string }).attemptId);
  expect(diff?.attemptId).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
  expect(JSON.stringify(diff)).not.toContain(name);
  expect(diff).not.toHaveProperty('rows');
});

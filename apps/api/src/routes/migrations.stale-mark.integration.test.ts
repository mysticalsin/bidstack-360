// WHY: a null-attempt mark that already cancelled one attempt was still
// applied to the next attempt written on the same job. Retry answers 409
// for a CANCELLED job, but the row can still be updated. List, detail, and
// the chunk must not treat that finished mark as live.

import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { purgeAuditRows } from '../test-support/purge-audit-rows.js';
import { makeMigrationsTestContext } from './migrations.test-helpers.js';

const { ctx, skipIfNoDb, createJob } = makeMigrationsTestContext();

skipIfNoDb('a finished null-attempt mark does not cancel the next attempt', async () => {
  const name = `Next Attempt ${randomUUID().slice(0, 8)}`;
  const job = await createJob({ status: 'RUNNING' });
  await prisma.migrationJob.update({
    where: { id: job.id },
    data: {
      totalRows: 1,
      processedRows: 0,
      errorRows: 0,
      meta: { entityType: 'companies', dedupStrategy: 'skip', mappings: { Name: 'company.name' } },
    },
  });
  await prisma.auditLog.create({
    data: {
      orgId: job.orgId,
      userId: job.userId,
      action: 'migration.cancel.requested',
      targetType: 'MigrationJob',
      targetId: job.id,
      diff: { attemptId: null },
    },
  });
  const cancel = await ctx.server.inject({
    method: 'DELETE',
    url: `/api/v1/migrations/${job.id}/cancel`,
  });
  expect(cancel.statusCode).toBe(200);
  const blocked = await ctx.server.inject({
    method: 'POST',
    url: `/api/v1/migrations/${job.id}/retry`,
  });
  expect(blocked.statusCode).toBe(409);
  const nextAttempt = randomUUID();
  await prisma.migrationJob.update({
    where: { id: job.id },
    data: {
      status: 'RUNNING',
      meta: {
        entityType: 'companies',
        dedupStrategy: 'skip',
        mappings: { Name: 'company.name' },
        attemptId: nextAttempt,
      },
    },
  });
  await prisma.$executeRaw`
    UPDATE migration_jobs SET started_at = NOW() WHERE id = ${job.id}::uuid
  `;
  const detail = await ctx.server.inject({
    method: 'GET',
    url: `/api/v1/migrations/${job.id}`,
  });
  const list = await ctx.server.inject({ method: 'GET', url: '/api/v1/migrations' });
  expect(detail.statusCode).toBe(200);
  expect(detail.json<{ cancelRequested?: boolean }>().cancelRequested).not.toBe(true);
  const listed = list.json<{ items: Array<{ id: string; cancelRequested?: boolean }> }>().items.find(
    (row) => row.id === job.id,
  );
  expect(listed?.cancelRequested).not.toBe(true);
  const { processMigrationChunk } = await import('../../../worker/src/queues/migration.js');
  await processMigrationChunk(
    {
      migrationJobId: job.id,
      orgId: job.orgId,
      userId: job.userId,
      source: 'CSV',
      entityType: 'companies',
      chunkOffset: 0,
      chunkSize: 100,
      totalRows: 1,
      redisKey: 'rows',
      mappings: { Name: 'company.name' },
      dedupStrategy: 'skip',
      attemptId: nextAttempt,
    },
    {
      readRows: async () => JSON.stringify([{ Name: name }]),
      enqueueChunk: async () => undefined,
      enqueueIntel: async () => undefined,
      env: {},
    },
    { info: () => undefined, warn: () => undefined },
  );
  const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
  expect(stored.status).toBe('COMPLETE');
  expect(await prisma.company.count({ where: { orgId: job.orgId, name } })).toBe(1);
  await prisma.company.deleteMany({ where: { orgId: job.orgId, name } });
  await purgeAuditRows({
    where: {
      targetId: job.id,
      action: { in: ['migration.cancel.requested', 'migration.cancel', 'migration.cancel.resolved'] },
    },
  });
});

skipIfNoDb('a null mark at the same instant as started_at still cancels that attempt', async () => {
  // WHY: the null-mark check is started_at >= mark.at. An equal timestamp
  // is still the same attempt. Changing >= to > lets this attempt finish.
  const job = await createJob({ status: 'RUNNING' });
  const attemptId = randomUUID();
  await prisma.migrationJob.update({
    where: { id: job.id },
    data: {
      totalRows: 1,
      meta: { entityType: 'companies', attemptId, dedupStrategy: 'skip', mappings: { Name: 'company.name' } },
    },
  });
  await prisma.auditLog.create({
    data: {
      orgId: job.orgId,
      userId: job.userId,
      action: 'migration.cancel.requested',
      targetType: 'MigrationJob',
      targetId: job.id,
      diff: { attemptId: null },
    },
  });
  await prisma.$executeRaw`
    UPDATE migration_jobs AS job
    SET started_at = mark.at
    FROM audit_log AS mark
    WHERE job.id = ${job.id}::uuid
      AND mark.target_id = job.id::text
      AND mark.action = 'migration.cancel.requested'
  `;
  const { processMigrationChunk } = await import('../../../worker/src/queues/migration.js');
  await processMigrationChunk(
    {
      migrationJobId: job.id,
      orgId: job.orgId,
      userId: job.userId,
      source: 'CSV',
      entityType: 'companies',
      chunkOffset: 0,
      chunkSize: 100,
      totalRows: 1,
      redisKey: 'rows',
      mappings: { Name: 'company.name' },
      dedupStrategy: 'skip',
      attemptId,
    },
    {
      readRows: async () => JSON.stringify([{ Name: 'Equal Clock Co' }]),
      enqueueChunk: async () => undefined,
      enqueueIntel: async () => undefined,
      env: {},
    },
    { info: () => undefined, warn: () => undefined },
  );
  const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
  expect(stored.status).toBe('CANCELLED');
  expect(await prisma.company.count({ where: { orgId: job.orgId, name: 'Equal Clock Co' } })).toBe(0);
  await purgeAuditRows({
    where: { targetId: job.id, action: { in: ['migration.cancel.requested', 'migration.cancel'] } },
  });
});

skipIfNoDb('a named mark older than the attempt does not cancel it', async () => {
  // WHY: a mark for this attempt only counts once the attempt has started.
  // Dropping mark.at >= started_at would cancel this job.
  const name = `Old Named ${randomUUID().slice(0, 8)}`;
  const attemptId = randomUUID();
  const job = await createJob({ status: 'RUNNING' });
  await prisma.migrationJob.update({
    where: { id: job.id },
    data: {
      totalRows: 1,
      meta: { entityType: 'companies', attemptId, dedupStrategy: 'skip', mappings: { Name: 'company.name' } },
    },
  });
  await prisma.$executeRaw`
    UPDATE migration_jobs SET started_at = NOW() WHERE id = ${job.id}::uuid
  `;
  await prisma.$executeRaw`
    INSERT INTO audit_log (org_id, user_id, action, target_type, target_id, diff, at)
    VALUES (
      ${job.orgId}::uuid,
      ${job.userId}::uuid,
      'migration.cancel.requested',
      'MigrationJob',
      ${job.id},
      jsonb_build_object('attemptId', ${attemptId}::text),
      NOW() - interval '1 hour'
    )
  `;
  const { processMigrationChunk } = await import('../../../worker/src/queues/migration.js');
  await processMigrationChunk(
    {
      migrationJobId: job.id,
      orgId: job.orgId,
      userId: job.userId,
      source: 'CSV',
      entityType: 'companies',
      chunkOffset: 0,
      chunkSize: 100,
      totalRows: 1,
      redisKey: 'rows',
      mappings: { Name: 'company.name' },
      dedupStrategy: 'skip',
      attemptId,
    },
    {
      readRows: async () => JSON.stringify([{ Name: name }]),
      enqueueChunk: async () => undefined,
      enqueueIntel: async () => undefined,
      env: {},
    },
    { info: () => undefined, warn: () => undefined },
  );
  const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
  expect(stored.status).toBe('COMPLETE');
  expect(await prisma.company.count({ where: { orgId: job.orgId, name } })).toBe(1);
  await prisma.company.deleteMany({ where: { orgId: job.orgId, name } });
  await purgeAuditRows({
    where: { targetId: job.id, action: { in: ['migration.cancel.requested', 'migration.cancel'] } },
  });
});

skipIfNoDb('list and detail both report a live cancelRequested', async () => {
  const job = await createJob({ status: 'RUNNING' });
  const attemptId = randomUUID();
  await prisma.migrationJob.update({
    where: { id: job.id },
    data: { meta: { attemptId }, startedAt: new Date(Date.now() - 60_000) },
  });
  await prisma.auditLog.create({
    data: {
      orgId: job.orgId,
      userId: job.userId,
      action: 'migration.cancel.requested',
      targetType: 'MigrationJob',
      targetId: job.id,
      diff: { attemptId },
    },
  });
  const detail = await ctx.server.inject({ method: 'GET', url: `/api/v1/migrations/${job.id}` });
  const list = await ctx.server.inject({ method: 'GET', url: '/api/v1/migrations' });
  expect(detail.json<{ cancelRequested?: boolean }>().cancelRequested).toBe(true);
  expect(
    list.json<{ items: Array<{ id: string; cancelRequested?: boolean }> }>().items.find((row) => row.id === job.id)
      ?.cancelRequested,
  ).toBe(true);
  await purgeAuditRows({ where: { targetId: job.id, action: 'migration.cancel.requested' } });
});

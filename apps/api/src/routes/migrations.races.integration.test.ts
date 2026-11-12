// WHY these races matter: a CSV start enqueues chunks and only then writes
// RUNNING by id, so a cancel that lands during enqueue is overwritten and the
// job looks running with dead chunks. Cancel and undo make the same mistake:
// they trust a status they read earlier, then update by id.

import { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@bidstack/db';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
  type IsolatedOrg,
} from '../test-support/isolated-org.js';

async function ageProgress(id: string): Promise<void> {
  const past = new Date(Date.now() - 16 * 60_000);
  await prisma.$executeRaw`
    UPDATE migration_jobs
    SET started_at = ${past}, updated_at = ${past}
    WHERE id = ${id}::uuid
  `;
}

/** A worker claim stamps progress, then the clock ages. The claim write must not refresh updatedAt. */
async function markWorkerClaim(id: string): Promise<void> {
  const past = new Date(Date.now() - 16 * 60_000).toISOString();
  await prisma.migrationJob.update({
    where: { id },
    data: { meta: { progressAt: past } },
  });
  await ageProgress(id);
}

let server: FastifyInstance;
let org: IsolatedOrg;
let restoreAuth: () => void;
let dbReachable = false;
let userId: string;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  org = await createIsolatedOrg('migration-races');
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  const user = await prisma.user.findFirst({
    where: { orgId: org.orgId },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!user) throw new Error('isolated org has no user');
  userId = user.id;
  server = await buildServer();
  await server.ready();
}, 120_000);

afterAll(async () => {
  if (server) await server.close();
  restoreAuth?.();
  if (org) await dropIsolatedOrg(org.orgId);
});

const t = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbReachable) throw new Error(`[skip] ${name} — DATABASE_URL not reachable`);
    await fn();
  });

describe('migration status races', () => {
  t('a cancel during enqueue is not overwritten by the start write', async () => {
    const { redis } = await import('../redis.js');
    (server as unknown as { redis: typeof redis }).redis = redis;

    const add = vi.spyOn(Queue.prototype, 'add').mockImplementation(async (name: unknown) => {
      const jobId = String(name).split('-chunk-')[0];
      // The cancel lands after the chunk is queued and before start returns.
      await prisma.migrationJob.update({
        where: { id: jobId },
        data: { status: 'CANCELLED', completedAt: new Date() },
      });
      return { id: String(name) } as never;
    });

    try {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/migrations/start-csv',
        payload: {
          source: 'CSV',
          entityType: 'company',
          rows: [{ name: 'Acme' }],
          mappings: { name: 'name' },
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{ id: string }>();
      const row = await prisma.migrationJob.findUnique({ where: { id: body.id } });
      // The cancel won. A later by-id RUNNING write must not revive the job.
      expect(row?.status).toBe('CANCELLED');
    } finally {
      add.mockRestore();
    }
  });

  t('an enqueue failure does not leave the job RUNNING', async () => {
    const { redis } = await import('../redis.js');
    (server as unknown as { redis: typeof redis }).redis = redis;
    const add = vi.spyOn(Queue.prototype, 'add').mockRejectedValue(new Error('queue down'));
    try {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/migrations/start-csv',
        payload: {
          source: 'CSV',
          entityType: 'company',
          rows: [{ name: 'Acme' }],
          mappings: { name: 'name' },
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{ id: string; status: string }>();
      expect(body.status).toBe('FAILED');
      add.mockResolvedValue({ id: 'chunk' } as never);
      const retry = await server.inject({
        method: 'POST',
        url: `/api/v1/migrations/${body.id}/retry`,
      });
      expect(retry.statusCode).toBe(200);
      expect(retry.json<{ status: string }>().status).toBe('RUNNING');
      const audit = await prisma.auditLog.findFirst({
        where: { orgId: org.orgId, targetId: body.id, action: 'migration.retry' },
      });
      const diff = audit?.diff as { previousAttempt?: string | null; attemptId?: string } | null;
      expect(audit?.userId).toBe(userId);
      expect(diff?.previousAttempt).toEqual(expect.any(String));
      expect(diff?.attemptId).toEqual(expect.any(String));
      expect(diff?.attemptId).not.toBe(diff?.previousAttempt);
    } finally {
      add.mockRestore();
    }
  });

  t('a retry does not keep the previous attempt clock', async () => {
    // WHY: copying progressAt makes the wizard say the new attempt is stalled,
    // and the worker fails it after 15 minutes without a new claim.
    const { redis } = await import('../redis.js');
    (server as unknown as { redis: typeof redis }).redis = redis;
    const add = vi.spyOn(Queue.prototype, 'add').mockRejectedValueOnce(new Error('queue down'));
    try {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/migrations/start-csv',
        payload: {
          source: 'CSV',
          entityType: 'company',
          rows: [{ name: 'Acme' }],
          mappings: { name: 'name' },
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{ id: string }>();
      const failed = await prisma.migrationJob.findUniqueOrThrow({ where: { id: body.id } });
      const past = new Date(Date.now() - 16 * 60_000).toISOString();
      await prisma.migrationJob.update({
        where: { id: body.id },
        data: { meta: { ...(failed.meta as object), progressAt: past } },
      });
      add.mockResolvedValue({ id: 'chunk' } as never);
      const retry = await server.inject({
        method: 'POST',
        url: `/api/v1/migrations/${body.id}/retry`,
      });
      expect(retry.statusCode).toBe(200);
      const detail = await server.inject({
        method: 'GET',
        url: `/api/v1/migrations/${body.id}`,
      });
      expect(detail.json<{ status: string }>().status).toBe('RUNNING');
      expect(detail.json<{ stalled?: boolean }>().stalled).toBe(false);
      const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: body.id } });
      expect((stored.meta as { progressAt?: unknown }).progressAt).toBeUndefined();
    } finally {
      add.mockRestore();
    }
  });

  t('retry is refused when the uploaded rows have expired', async () => {
    // WHY: the rows are gone. A retry would fail again, so the API refuses it.
    const { redis } = await import('../redis.js');
    (server as unknown as { redis: typeof redis }).redis = redis;
    const add = vi.spyOn(Queue.prototype, 'add').mockRejectedValueOnce(new Error('queue down'));
    try {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/migrations/start-csv',
        payload: {
          source: 'CSV',
          entityType: 'company',
          rows: [{ name: 'Acme' }],
          mappings: { name: 'name' },
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{ id: string }>();
      await prisma.migrationJob.update({
        where: { id: body.id },
        data: { errorSummary: [{ row: 0, field: null, message: 'rows_expired' }] },
      });
      const retry = await server.inject({
        method: 'POST',
        url: `/api/v1/migrations/${body.id}/retry`,
      });
      expect(retry.statusCode).toBe(409);
      const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: body.id } });
      expect(stored.status).toBe('FAILED');
    } finally {
      add.mockRestore();
    }
  });

  t('retry uses the mapping stored on the failed attempt', async () => {
    // WHY: the shared mapping row is the latest import, not this attempt.
    // Retrying with it would write the failed file through someone else's columns.
    const { redis } = await import('../redis.js');
    (server as unknown as { redis: typeof redis }).redis = redis;
    const added: Array<{ mappings?: Record<string, string | null> }> = [];
    const add = vi.spyOn(Queue.prototype, 'add').mockImplementation(async (_name, data) => {
      added.push(data as { mappings?: Record<string, string | null> });
      if (added.length === 1) throw new Error('queue down');
      return { id: 'chunk' } as never;
    });
    try {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/migrations/start-csv',
        payload: {
          source: 'CSV',
          entityType: 'company',
          rows: [{ name: 'Acme' }],
          mappings: { Name: 'company.name' },
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{ id: string }>();
      await prisma.migrationMapping.update({
        where: {
          orgId_source_sourceEntity: { orgId: org.orgId, source: 'CSV', sourceEntity: 'company' },
        },
        data: { mappings: { Name: 'company.website' } },
      });
      const retry = await server.inject({
        method: 'POST',
        url: `/api/v1/migrations/${body.id}/retry`,
      });
      expect(retry.statusCode).toBe(200);
      expect(added[1]?.mappings).toEqual({ Name: 'company.name' });
    } finally {
      add.mockRestore();
    }
  });

  t('a committed chunk can still be undone when a later enqueue fails', async () => {
    // WHY: the first chunk can commit before the next queue add throws.
    // The job is then failed, retry refuses it, and undo refuses it too.
    const { redis } = await import('../redis.js');
    (server as unknown as { redis: typeof redis }).redis = redis;
    let calls = 0;
    const add = vi.spyOn(Queue.prototype, 'add').mockImplementation(async () => {
      calls += 1;
      if (calls > 1) throw new Error('queue down');
      return { id: 'chunk-0' } as never;
    });
    try {
      const rows = Array.from({ length: 101 }, (_, i) => ({ name: `Co ${i}` }));
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/migrations/start-csv',
        payload: {
          source: 'CSV',
          entityType: 'company',
          rows,
          mappings: { name: 'company.name' },
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{ id: string; status: string }>();
      expect(body.status).toBe('FAILED');
      const company = await prisma.company.create({
        data: { orgId: org.orgId, name: `Kept ${body.id}`, source: `migration:${body.id}` },
      });
      await prisma.migrationJob.update({
        where: { id: body.id },
        data: { processedRows: 1 },
      });
      await prisma.auditLog.create({
        data: {
          orgId: org.orgId,
          action: 'migration.chunk.imported',
          targetType: 'MigrationJob',
          targetId: body.id,
          diff: { entity: 'company', createdIds: [company.id] },
        },
      });
      const undo = await server.inject({
        method: 'DELETE',
        url: `/api/v1/migrations/${body.id}/undo`,
      });
      expect(undo.statusCode).toBe(200);
      expect(await prisma.company.findUnique({ where: { id: company.id } })).toBeNull();
    } finally {
      add.mockRestore();
    }
  });

  t('a chunk that commits while the next enqueue is waiting can be undone', async () => {
    // WHY: chunk 0 can land in the CRM before chunk 1's queue add throws.
    // The job is then failed, so retry refuses it. Undo is the way back.
    const { redis } = await import('../redis.js');
    (server as unknown as { redis: typeof redis }).redis = redis;
    let calls = 0;
    let rejectNext: (err: Error) => void = () => undefined;
    const blocked = new Promise<never>((_resolve, reject) => {
      rejectNext = reject;
    });
    let chunk0: { migrationJobId?: string } | null = null;
    const add = vi.spyOn(Queue.prototype, 'add').mockImplementation(async (_name, data) => {
      calls += 1;
      if (calls === 1) {
        chunk0 = data as { migrationJobId?: string };
        return { id: 'chunk-0' } as never;
      }
      return blocked;
    });
    try {
      const rows = Array.from({ length: 101 }, (_, i) => ({ name: `Co ${i}` }));
      const pending = server.inject({
        method: 'POST',
        url: '/api/v1/migrations/start-csv',
        payload: {
          source: 'CSV',
          entityType: 'company',
          rows,
          mappings: { name: 'company.name' },
        },
      });
      await vi.waitFor(() => expect(calls).toBe(2));
      const { processMigrationChunk } = await import('../../../worker/src/queues/migration.js');
      await processMigrationChunk(
        chunk0 as never,
        {
          readRows: (key) => redis.get(key),
          enqueueChunk: async () => undefined,
          enqueueIntel: async () => undefined,
          env: { ACCOUNT_INTEL_IMPORT_ENRICH: 'false' },
        },
        { info: () => undefined, warn: () => undefined },
      );
      const source = `migration:${chunk0?.migrationJobId ?? ''}`;
      expect(await prisma.company.count({ where: { orgId: org.orgId, source } })).toBeGreaterThan(0);
      rejectNext(new Error('queue down'));
      const res = await pending;
      expect(res.statusCode).toBe(201);
      const body = res.json<{ id: string; status: string }>();
      expect(body.status).toBe('FAILED');
      const retry = await server.inject({
        method: 'POST',
        url: `/api/v1/migrations/${body.id}/retry`,
      });
      expect(retry.statusCode).toBe(409);
      const undo = await server.inject({
        method: 'DELETE',
        url: `/api/v1/migrations/${body.id}/undo`,
      });
      expect(undo.statusCode).toBe(200);
      expect(await prisma.company.count({ where: { orgId: org.orgId, source } })).toBe(0);
    } finally {
      rejectNext(new Error('queue down'));
      add.mockRestore();
    }
  });

  t('a retry is not failed stale before a new claim', async () => {
    // WHY: the stale scan fails a running import 15 minutes after the last
    // claim. A retry that kept that clock would be failed without a worker
    // ever claiming the new attempt.
    const { redis } = await import('../redis.js');
    (server as unknown as { redis: typeof redis }).redis = redis;
    const add = vi.spyOn(Queue.prototype, 'add').mockRejectedValueOnce(new Error('queue down'));
    try {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/migrations/start-csv',
        payload: {
          source: 'CSV',
          entityType: 'company',
          rows: [{ name: 'Acme' }],
          mappings: { name: 'name' },
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{ id: string }>();
      const failed = await prisma.migrationJob.findUniqueOrThrow({ where: { id: body.id } });
      const past = new Date(Date.now() - 16 * 60_000).toISOString();
      await prisma.migrationJob.update({
        where: { id: body.id },
        data: { meta: { ...(failed.meta as object), progressAt: past } },
      });
      add.mockResolvedValue({ id: 'chunk' } as never);
      const retry = await server.inject({
        method: 'POST',
        url: `/api/v1/migrations/${body.id}/retry`,
      });
      expect(retry.statusCode).toBe(200);
      await ageProgress(body.id);
      const { sweepStaleMigrations } = await import('../../../worker/src/queues/migration.js');
      await sweepStaleMigrations(new Date());
      const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: body.id } });
      expect(stored.status).toBe('RUNNING');
      expect(stored.errorSummary).toEqual([]);
    } finally {
      add.mockRestore();
    }
  });

  t('a failed retry audit does not leave the new attempt running', async () => {
    // WHY: the audit names who retried which attempt. If that row is written
    // after the status commits, a failed insert leaves a running import with
    // no record of the retry.
    const { redis } = await import('../redis.js');
    (server as unknown as { redis: typeof redis }).redis = redis;
    const add = vi.spyOn(Queue.prototype, 'add').mockRejectedValueOnce(new Error('queue down'));
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION fail_retry_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'migration.retry' THEN
          RAISE EXCEPTION 'audit down';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER fail_retry_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_retry_audit()`,
    );
    try {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/migrations/start-csv',
        payload: {
          source: 'CSV',
          entityType: 'company',
          rows: [{ name: 'Acme' }],
          mappings: { name: 'name' },
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{ id: string }>();
      add.mockResolvedValue({ id: 'chunk' } as never);
      const retry = await server.inject({
        method: 'POST',
        url: `/api/v1/migrations/${body.id}/retry`,
      });
      expect(retry.statusCode).toBeGreaterThanOrEqual(500);
      const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: body.id } });
      expect(stored.status).toBe('FAILED');
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS fail_retry_audit ON audit_log`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS fail_retry_audit()`);
      add.mockRestore();
    }
  });

  t('cancel does not trust a stale RUNNING read over a finished job', async () => {
    const job = await prisma.migrationJob.create({
      data: {
        orgId: org.orgId,
        userId,
        source: 'CSV',
        status: 'COMPLETE',
        totalRows: 1,
        processedRows: 1,
      },
    });
    const original = prisma.migrationJob.findFirst.bind(prisma.migrationJob);
    const read = vi.spyOn(prisma.migrationJob, 'findFirst').mockImplementation(async (args) => {
      const row = await original(args as never);
      if (row && row.id === job.id) return { ...row, status: 'RUNNING' };
      return row;
    });
    try {
      const res = await server.inject({
        method: 'DELETE',
        url: `/api/v1/migrations/${job.id}/cancel`,
      });
      expect(res.statusCode).toBe(409);
      const row = await prisma.migrationJob.findUnique({ where: { id: job.id } });
      expect(row?.status).toBe('COMPLETE');
    } finally {
      read.mockRestore();
    }
  });

  t('list and detail agree, and a queued job is not stale', async () => {
    // WHY: stale is no progress since a worker claimed the chunk. A job that
    // was only marked running, and is still waiting in the queue, stays running.
    // The list and the detail poll must report that same derived flag.
    const backlog = await prisma.migrationJob.create({
      data: {
        orgId: org.orgId,
        userId,
        source: 'CSV',
        status: 'RUNNING',
        totalRows: 1,
        processedRows: 0,
        errorRows: 0,
        startedAt: new Date(),
      },
    });
    await ageProgress(backlog.id);
    const detail = await server.inject({ method: 'GET', url: `/api/v1/migrations/${backlog.id}` });
    const list = await server.inject({ method: 'GET', url: '/api/v1/migrations' });
    expect(detail.statusCode).toBe(200);
    expect(detail.json<{ status: string; stalled?: boolean }>().stalled).toBe(false);
    const listed = list.json<{ items: Array<{ id: string; stalled?: boolean; status: string }> }>().items.find(
      (item) => item.id === backlog.id,
    );
    expect(listed?.status).toBe('RUNNING');
    expect(listed?.stalled).toBe(false);
    const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: backlog.id } });
    expect(stored.status).toBe('RUNNING');
  });

  t('GET reports a stale import without writing it', async () => {
    // WHY: a progress poll must not be the writer. A read-only or cross-site
    // GET used to fail the row, which is a state change from a safe method.
    const job = await prisma.migrationJob.create({
      data: {
        orgId: org.orgId,
        userId,
        source: 'CSV',
        status: 'RUNNING',
        totalRows: 1,
        processedRows: 0,
        errorRows: 0,
        startedAt: new Date(),
      },
    });
    await markWorkerClaim(job.id);
    const before = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });

    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/migrations/${job.id}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ status: string; stalled?: boolean }>();
    expect(body.status).toBe('RUNNING');
    expect(body.stalled).toBe(true);
    const after = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.status).toBe('RUNNING');
    expect(after.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
  });

  t('a read-only user and a cross-site GET cannot fail a stale import', async () => {
    const job = await prisma.migrationJob.create({
      data: {
        orgId: org.orgId,
        userId,
        source: 'CSV',
        status: 'RUNNING',
        totalRows: 1,
        processedRows: 0,
        errorRows: 0,
        startedAt: new Date(),
      },
    });
    await markWorkerClaim(job.id);
    const previousRole = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
    process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
    try {
      const reader = await server.inject({
        method: 'GET',
        url: `/api/v1/migrations/${job.id}`,
        headers: { 'x-bidstack-e2e-role': 'read-only' },
      });
      expect(reader.statusCode).toBe(200);
      expect(reader.json<{ status: string }>().status).toBe('RUNNING');

      const other = await createIsolatedOrg('migration-cross');
      const restore = useIsolatedOrgAuth(other.clerkOrg);
      try {
        const foreign = await server.inject({
          method: 'GET',
          url: `/api/v1/migrations/${job.id}`,
        });
        expect(foreign.statusCode).toBe(404);
      } finally {
        restore();
        await dropIsolatedOrg(other.orgId);
      }
    } finally {
      if (previousRole === undefined) delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
      else process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previousRole;
    }
    const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(stored.status).toBe('RUNNING');
  });

  t('undo does not trust a stale COMPLETE read over a job that is still running', async () => {
    const job = await prisma.migrationJob.create({
      data: {
        orgId: org.orgId,
        userId,
        source: 'CSV',
        status: 'RUNNING',
        totalRows: 1,
        startedAt: new Date(),
      },
    });
    const original = prisma.migrationJob.findFirst.bind(prisma.migrationJob);
    const read = vi.spyOn(prisma.migrationJob, 'findFirst').mockImplementation(async (args) => {
      const row = await original(args as never);
      if (row && row.id === job.id) {
        return { ...row, status: 'COMPLETE', undoableUntil: new Date(Date.now() + 60_000) };
      }
      return row;
    });
    try {
      const res = await server.inject({
        method: 'DELETE',
        url: `/api/v1/migrations/${job.id}/undo`,
      });
      expect(res.statusCode).toBe(409);
      const row = await prisma.migrationJob.findUnique({ where: { id: job.id } });
      expect(row?.status).toBe('RUNNING');
    } finally {
      read.mockRestore();
    }
  });
});

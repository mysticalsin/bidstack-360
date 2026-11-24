// WHY: Hammer held the row the way start does. The route reads NOW() and
// then waits on the claim, so started_at is about two seconds before the
// cancel mark. A comparison of those clocks never sees the mark. The claim
// has to consume the pre-start mark and cancel the job before it starts.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';
import { PrismaClient } from '../../../../packages/db/generated/client/index.js';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
  type IsolatedOrg,
} from '../test-support/isolated-org.js';
import { purgeAuditRows } from '../test-support/purge-audit-rows.js';

const PAUSE = 481516234;
let locker: PrismaClient;
let server: FastifyInstance;
let org: IsolatedOrg;
let restore: (() => void) | undefined;
let dbReachable = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  org = await createIsolatedOrg('start-claim');
  restore = useIsolatedOrgAuth(org.clerkOrg);
  server = await buildServer();
  await server.ready();
  locker = new PrismaClient();
  await locker.$connect();
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION bidstack_pause_migration_claim() RETURNS trigger
    LANGUAGE plpgsql AS $fn$
    BEGIN
      PERFORM pg_advisory_lock(${PAUSE});
      PERFORM pg_advisory_unlock(${PAUSE});
      RETURN NEW;
    END
    $fn$
  `);
  await prisma.$executeRawUnsafe(`
    DROP TRIGGER IF EXISTS bidstack_pause_migration_claim ON migration_jobs
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER bidstack_pause_migration_claim
    BEFORE UPDATE ON migration_jobs
    FOR EACH ROW EXECUTE FUNCTION bidstack_pause_migration_claim()
  `);
}, 120_000);

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS bidstack_pause_migration_claim ON migration_jobs`).catch(() => undefined);
  await locker?.$disconnect().catch(() => undefined);
  restore?.();
  if (server) await server.close();
  if (org) await dropIsolatedOrg(org.orgId);
});

it(
  'cancel during the real start claim cancels the job before it imports',
  async () => {
    if (!dbReachable) throw new Error('[skip] start claim — DATABASE_URL not reachable');
    const name = `Claim ${randomUUID().slice(0, 8)}`;
    await locker.$executeRaw`SELECT pg_advisory_lock(${PAUSE}::bigint)`;
    const starting = server.inject({
      method: 'POST',
      url: '/api/v1/migrations/start-csv',
      payload: {
        source: 'CSV',
        entityType: 'companies',
        rows: [{ Name: name }],
        mappings: { Name: 'company.name' },
        dedupStrategy: 'skip',
      },
    });
    let jobId = '';
    const seen = Date.now();
    while (!jobId && Date.now() - seen < 8_000) {
      const settled = await Promise.race([
        starting.then((res) => ({ done: true as const, res })),
        new Promise<{ done: false }>((resolve) => setTimeout(() => resolve({ done: false }), 20)),
      ]);
      if (settled.done) {
        expect(settled.res.statusCode, settled.res.body).toBe(201);
      }
      const row = await prisma.migrationJob.findFirst({
        where: { orgId: org.orgId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true },
      });
      if (row && row.status === 'PENDING') jobId = row.id;
    }
    expect(jobId, 'start did not leave a pending job').not.toBe('');
    try {
      const started = Date.now();
      const cancel = await server.inject({
        method: 'DELETE',
        url: `/api/v1/migrations/${jobId}/cancel`,
      });
      const cancelMs = Date.now() - started;
      expect(cancel.statusCode).toBe(202);
      expect(cancel.json<{ cancelRequested?: boolean }>().cancelRequested).toBe(true);
      expect(cancelMs).toBeGreaterThanOrEqual(2_000);
    } finally {
      await locker.$executeRaw`SELECT pg_advisory_unlock(${PAUSE}::bigint)`;
    }
    const startedRes = await starting;
    expect(startedRes.statusCode).toBe(201);
    const body = startedRes.json<{ status: string; id: string }>();
    expect(body.status).toBe('CANCELLED');
    const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: jobId } });
    const mark = await prisma.auditLog.findFirst({
      where: { targetId: jobId, action: 'migration.cancel.requested', targetType: 'MigrationJob' },
      orderBy: { at: 'asc' },
    });
    const applied = await prisma.auditLog.findFirst({
      where: { targetId: jobId, action: 'migration.cancel', targetType: 'MigrationJob' },
    });
    expect((mark?.diff as { attemptId?: string | null } | null)?.attemptId ?? null).toBeNull();
    expect(stored.startedAt && mark?.at && stored.startedAt < mark.at).toBe(true);
    expect((applied?.diff as { attemptId?: string } | null)?.attemptId).toBe(
      (stored.meta as { attemptId?: string }).attemptId,
    );
    expect(await prisma.company.count({ where: { orgId: org.orgId, name } })).toBe(0);
    await purgeAuditRows({
      where: { targetId: jobId, action: { in: ['migration.cancel.requested', 'migration.cancel', 'migration.start'] } },
    });
  },
  30_000,
);

// WHY: HubSpot start writes startedAt from the API clock. A cancel mark is
// stamped by the database. An API clock a few seconds ahead makes the mark
// look older than the attempt, and the chunk ignores it.

import { randomUUID } from 'node:crypto';
import type { Queue } from 'bullmq';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';

import { prisma } from '@bidstack/db';

vi.mock('../lib/serum-connector-policy.js', () => ({
  assertSerumConnectorAllowed: async () => ({ allowed: true }),
}));

import { startHubspotImport } from './hubspot-import.js';

const RealDate = Date;
let dbReachable = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
  }
}, 30_000);

afterAll(async () => {
  await prisma.$disconnect();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('a HubSpot start keeps startedAt on the database clock when the API clock is ahead', async () => {
  if (!dbReachable) throw new Error('[skip] hubspot clock — DATABASE_URL not reachable');
  const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const org = await prisma.org.create({
    data: { clerkOrg: `org_hs_clk_${ns}`, name: `hs ${ns}` },
  });
  const user = await prisma.user.create({
    data: { orgId: org.id, clerkUser: `user_${ns}`, email: `${ns}@test.local`, name: 'HubSpot' },
  });
  await prisma.integrationConfig.create({
    data: {
      orgId: org.id,
      type: 'hubspot',
      name: 'hubspot-migration',
      isActive: true,
      config: { discovery: { companies: 1 } },
    },
  });
  class AheadDate extends RealDate {
    constructor(...args: ConstructorParameters<typeof Date>) {
      if (args.length === 0) super(RealDate.now() + 5_000);
      else super(...args);
    }

    static now(): number {
      return RealDate.now() + 5_000;
    }
  }
  vi.stubGlobal('Date', AheadDate);
  const queue = { add: vi.fn(async () => undefined) } as unknown as Queue;
  try {
    await startHubspotImport({
      orgId: org.id,
      userId: user.id,
      entities: ['companies'],
      dedupStrategy: 'skip',
      queue,
    });
  } finally {
    vi.unstubAllGlobals();
  }
  const rows = await prisma.$queryRaw<Array<{ skew: number }>>`
    SELECT EXTRACT(EPOCH FROM (started_at - NOW()))::float8 AS skew
    FROM migration_jobs
    WHERE org_id = ${org.id}::uuid AND source = 'HUBSPOT_OAUTH'
  `;
  expect(rows[0]?.skew ?? 99).toBeLessThan(2);
  const stored = await prisma.migrationJob.findFirstOrThrow({
    where: { orgId: org.id, source: 'HUBSPOT_OAUTH' },
  });
  const attemptId = (stored.meta as { attemptId?: string }).attemptId ?? '';
  await prisma.auditLog.create({
    data: {
      orgId: org.id,
      userId: user.id,
      action: 'migration.cancel.requested',
      targetType: 'MigrationJob',
      targetId: stored.id,
      diff: { attemptId },
    },
  });
  const { processMigrationChunk } = await import('../../../worker/src/queues/migration.js');
  await processMigrationChunk(
    {
      migrationJobId: stored.id,
      orgId: org.id,
      userId: user.id,
      source: 'CSV',
      entityType: 'companies',
      chunkOffset: 0,
      chunkSize: 100,
      totalRows: 1,
      redisKey: 'rows',
      mappings: { Name: 'company.name' },
      dedupStrategy: 'skip',
      attemptId,
      hubspotAfter: undefined,
    },
    {
      readRows: async () => JSON.stringify([{ Name: 'HubSpot Clock Co' }]),
      enqueueChunk: async () => undefined,
      enqueueIntel: async () => undefined,
      env: {},
    },
    { info: () => undefined, warn: () => undefined },
  );
  const after = await prisma.migrationJob.findUniqueOrThrow({ where: { id: stored.id } });
  expect(after.status).toBe('CANCELLED');
  expect(await prisma.company.count({ where: { orgId: org.id, name: 'HubSpot Clock Co' } })).toBe(0);
  await prisma.org.delete({ where: { id: org.id } });
});

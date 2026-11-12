// WHY: BullMQ retries an old chunk after a newer attempt has started. When
// those retries run out, the old chunk must not mark the new attempt failed.

import { prisma } from '@bidstack/db';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

import { failExhaustedMigrationChunk } from './migration.js';

let dbReachable = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
  }
}, 30_000);

const t = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbReachable) throw new Error(`[skip] ${name} — DATABASE_URL not reachable`);
    await fn();
  });

const PREVIOUS = '11111111-1111-4111-8111-111111111111';
const CURRENT = '22222222-2222-4222-8222-222222222222';

const log = {
  error: () => undefined,
  warn: () => undefined,
};

describe('an exhausted chunk retry', () => {
  t('does not fail a job whose attempt has moved on', async () => {
    const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const org = await prisma.org.create({
      data: { clerkOrg: `org_mig_ex_${ns}`, name: `ex ${ns}` },
    });
    const user = await prisma.user.create({
      data: { orgId: org.id, clerkUser: `user_${ns}`, email: `${ns}@test.local`, name: 'ex' },
    });
    const job = await prisma.migrationJob.create({
      data: {
        orgId: org.id,
        userId: user.id,
        source: 'CSV',
        status: 'RUNNING',
        totalRows: 1,
        processedRows: 0,
        startedAt: new Date(),
        meta: { entityType: 'companies', attemptId: CURRENT },
      },
    });
    await failExhaustedMigrationChunk(
      { migrationJobId: job.id, attemptId: PREVIOUS },
      new Error('old chunk exhausted'),
      log,
    );
    const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(stored.status).toBe('RUNNING');
    expect(JSON.stringify(stored.errorSummary)).not.toMatch(/old chunk exhausted/);
    await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
  });

  t('fails the job when the exhausted chunk is still the current attempt', async () => {
    const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const org = await prisma.org.create({
      data: { clerkOrg: `org_mig_ex2_${ns}`, name: `ex2 ${ns}` },
    });
    const user = await prisma.user.create({
      data: { orgId: org.id, clerkUser: `user_${ns}`, email: `${ns}@test.local`, name: 'ex2' },
    });
    const job = await prisma.migrationJob.create({
      data: {
        orgId: org.id,
        userId: user.id,
        source: 'CSV',
        status: 'RUNNING',
        totalRows: 1,
        processedRows: 0,
        startedAt: new Date(),
        meta: { entityType: 'companies', attemptId: CURRENT },
      },
    });
    await failExhaustedMigrationChunk(
      { migrationJobId: job.id, attemptId: CURRENT },
      new Error('current chunk exhausted'),
      log,
    );
    const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(stored.status).toBe('FAILED');
    await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
  });
});

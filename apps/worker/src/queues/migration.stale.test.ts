// WHY: the stale scan and a chunk can pass each other. The scan must claim
// RUNNING → FAILED only while the progress time it observed is still current.
// A chunk that just committed moves that clock and keeps the job running.

import { prisma } from '@bidstack/db';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

import { claimStaleMigration, sweepStaleMigrations } from './migration.js';

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

async function runningJob() {
  const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const org = await prisma.org.create({
    data: { clerkOrg: `org_mig_stale_${ns}`, name: `stale ${ns}` },
  });
  const user = await prisma.user.create({
    data: { orgId: org.id, clerkUser: `user_${ns}`, email: `${ns}@test.local`, name: 'Stale' },
  });
  const job = await prisma.migrationJob.create({
    data: {
      orgId: org.id,
      userId: user.id,
      source: 'CSV',
      status: 'RUNNING',
      totalRows: 2,
      processedRows: 0,
      errorRows: 0,
      startedAt: new Date(),
    },
  });
  const past = new Date(Date.now() - 16 * 60_000);
  await prisma.$executeRaw`
    UPDATE migration_jobs SET updated_at = ${past}, started_at = ${past} WHERE id = ${job.id}::uuid
  `;
  return { org, job };
}

describe('migration stale scan', () => {
  t('a chunk that just reported progress beats the stale claim', async () => {
    const { org, job } = await runningJob();
    const observed = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
    await prisma.migrationJob.update({
      where: { id: job.id },
      data: { processedRows: 1 },
    });
    const claimed = await claimStaleMigration(job.id, observed.updatedAt);
    const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(claimed).toBe(false);
    expect(stored.status).toBe('RUNNING');
    expect(stored.processedRows).toBe(1);
    await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
  });

  t('a running import with no progress is failed with reason stale', async () => {
    const { org, job } = await runningJob();
    const claimed = await sweepStaleMigrations(new Date());
    expect(claimed).toBe(1);
    const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(stored.status).toBe('FAILED');
    const summary = stored.errorSummary as Array<{ message?: string }>;
    expect(summary[0]?.message).toBe('stale');
    await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
  });
});

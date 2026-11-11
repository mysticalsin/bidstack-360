// WHY: HubSpot start writes the job RUNNING and then enqueues the first chunk.
// If the queue rejects, the job must become FAILED from RUNNING. Leaving it
// RUNNING strands a job that has no chunks, and a later cancel must not be
// overwritten by a by-id write.

import { randomUUID } from 'node:crypto';
import type { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@bidstack/db';

vi.mock('../lib/serum-connector-policy.js', () => ({
  assertSerumConnectorAllowed: async () => ({ allowed: true }),
}));

import { startHubspotImport } from './hubspot-import.js';

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

const t = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbReachable) throw new Error(`[skip] ${name} — DATABASE_URL not reachable`);
    await fn();
  });

describe('HubSpot import enqueue', () => {
  t('a failed enqueue marks the claimed job failed', async () => {
    const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const org = await prisma.org.create({
      data: { clerkOrg: `org_hs_enq_${ns}`, name: `hs ${ns}` },
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
    const queue = { add: vi.fn(async () => { throw new Error('queue down'); }) } as unknown as Queue;

    await expect(
      startHubspotImport({
        orgId: org.id,
        userId: user.id,
        entities: ['companies'],
        dedupStrategy: 'skip',
        queue,
      }),
    ).rejects.toThrow(/queue down/);

    const job = await prisma.migrationJob.findFirst({
      where: { orgId: org.id, source: 'HUBSPOT_OAUTH' },
      select: { status: true, errorSummary: true },
    });
    expect(job?.status).toBe('FAILED');
    expect(JSON.stringify(job?.errorSummary)).toContain('Failed to enqueue import chunks');
    await prisma.org.delete({ where: { id: org.id } });
  });
});

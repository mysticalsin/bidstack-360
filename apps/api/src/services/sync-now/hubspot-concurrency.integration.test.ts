import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@bidstack/db';

import type * as HubspotImport from '../hubspot-import.js';
import { createIsolatedOrg, dropIsolatedOrg } from '../../test-support/isolated-org.js';
import { startHubspotSync } from './hubspot.js';
import { SyncUnavailableError } from './errors.js';

const importCalls = vi.hoisted(() => ({ count: 0, entities: [] as string[] }));

// The real import awaits the HubSpot connection and the connector policy
// before it writes its first MigrationJob; the delay reproduces that window.
vi.mock('../hubspot-import.js', async (importOriginal) => {
  const actual = await importOriginal<typeof HubspotImport>();
  const { prisma: db } = await import('@bidstack/db');
  return {
    ...actual,
    startHubspotImport: async (input: {
      orgId: string;
      userId: string;
      entities: readonly string[];
      syncRunId?: string;
    }) => {
      importCalls.count += 1;
      importCalls.entities = [...input.entities];
      await new Promise((resolve) => setTimeout(resolve, 300));
      return [
        await db.migrationJob.create({
          data: {
            orgId: input.orgId,
            userId: input.userId,
            source: 'HUBSPOT_OAUTH',
            status: 'RUNNING',
            startedAt: new Date(),
            totalRows: 0,
            meta: { entityType: 'companies', syncRunId: input.syncRunId },
          },
        }),
      ];
    },
  };
});

describe('HubSpot sync now start guard', () => {
  let orgId: string;
  let userId: string;

  beforeAll(async () => {
    const org = await createIsolatedOrg('syncnow-race');
    orgId = org.orgId;
    const admin = await prisma.user.findFirst({ where: { orgId }, select: { id: true } });
    userId = admin!.id;
  });

  afterAll(async () => {
    if (orgId) await dropIsolatedOrg(orgId);
  });

  it('two concurrent starts with different idempotency keys start exactly one import', async () => {
    importCalls.count = 0;
    const results = await Promise.allSettled([
      startHubspotSync({ orgId, userId, idempotencyKey: `sync-${randomUUID()}` }),
      startHubspotSync({ orgId, userId, idempotencyKey: `sync-${randomUUID()}` }),
    ]);

    expect(importCalls.count).toBe(1);
    // The migration worker cannot import HubSpot tasks and fails that job,
    // which would fail the whole run.
    expect(importCalls.entities).toEqual(['companies', 'contacts', 'deals']);
    const jobs = await prisma.migrationJob.count({
      where: { orgId, source: 'HUBSPOT_OAUTH', status: 'RUNNING' },
    });
    expect(jobs).toBe(1);

    const runIds = new Set<string>();
    for (const r of results) {
      if (r.status === 'fulfilled') runIds.add(r.value.runId);
      else expect(r.reason).toBeInstanceOf(SyncUnavailableError);
    }
    expect(runIds.size).toBe(1);
  });
});

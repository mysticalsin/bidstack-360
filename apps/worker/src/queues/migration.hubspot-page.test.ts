// WHY: a HubSpot page that has already committed must stay retryable when the
// next page cannot be queued. Failing the job makes the BullMQ retry return
// at the running-status guard, and the import stops short of the next page.

import { prisma } from '@bidstack/db';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/serum-connector-policy.js', () => ({
  serumConnectorDenialMessage: async () => null,
}));

vi.mock('@bidstack/shared/server-crypto', () => ({
  decryptSecret: () => JSON.stringify({ accessToken: 'hubspot-access' }),
}));

import { processMigrationChunk, type MigrationChunkDeps } from './migration.js';

let dbReachable = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
  }
}, 30_000);

afterEach(() => {
  vi.unstubAllGlobals();
});

const t = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbReachable) throw new Error(`[skip] ${name} — DATABASE_URL not reachable`);
    await fn();
  });

const ATTEMPT = '66666666-6666-4666-8666-666666666666';

describe('a HubSpot page whose next enqueue fails', () => {
  t('stays running so the retry refetches the page and queues the next one', async () => {
    const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const org = await prisma.org.create({
      data: { clerkOrg: `org_hs_${ns}`, name: `hs ${ns}` },
    });
    try {
      const user = await prisma.user.create({
        data: { orgId: org.id, clerkUser: `user_${ns}`, email: `${ns}@test.local`, name: 'hs' },
      });
      await prisma.integrationConfig.create({
        data: {
          orgId: org.id,
          type: 'hubspot',
          name: 'hubspot-migration',
          credentials: { encrypted: 'ciphertext' },
        },
      });
      const job = await prisma.migrationJob.create({
        data: {
          orgId: org.id,
          userId: user.id,
          source: 'HUBSPOT_OAUTH',
          status: 'RUNNING',
          totalRows: 2,
          processedRows: 0,
          startedAt: new Date(),
          meta: { entityType: 'companies', attemptId: ATTEMPT },
        },
      });
      const fetchMock = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              results: [{ id: '1', properties: { name: `Acme ${ns}` } }],
              paging: { next: { after: 'cursor-2' } },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      );
      vi.stubGlobal('fetch', fetchMock);
      let enqueued = 0;
      const deps: MigrationChunkDeps = {
        readRows: async () => null,
        enqueueChunk: async (_name, data) => {
          enqueued += 1;
          if (enqueued === 1) throw new Error('queue down');
          expect(data.hubspotAfter).toBe('cursor-2');
        },
        enqueueIntel: async () => undefined,
        env: { ACCOUNT_INTEL_IMPORT_ENRICH: 'false' },
      };
      const payload = {
        migrationJobId: job.id,
        orgId: org.id,
        userId: user.id,
        source: 'HUBSPOT_OAUTH' as const,
        entityType: 'companies',
        chunkOffset: 0,
        chunkSize: 100,
        totalRows: 2,
        mappings: { name: 'company.name' },
        dedupStrategy: 'update' as const,
        attemptId: ATTEMPT,
      };
      const log = { info: () => undefined, warn: () => undefined };
      await expect(processMigrationChunk(payload, deps, log)).rejects.toThrow(/queue down/);
      const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(stored.status).toBe('RUNNING');
      expect(stored.processedRows).toBe(1);
      await processMigrationChunk(payload, deps, log);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(enqueued).toBe(2);
      expect(await prisma.company.count({ where: { orgId: org.id, deletedAt: null } })).toBe(1);
    } finally {
      await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
    }
  });

  t('retries the page whose next enqueue failed after an earlier page was queued', async () => {
    // WHY: the first page can be queued and committed, and the page after it
    // can fail to enqueue. Failing the job there makes the retry of that page
    // return without asking HubSpot for it again.
    const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const org = await prisma.org.create({
      data: { clerkOrg: `org_hs2_${ns}`, name: `hs2 ${ns}` },
    });
    try {
      const user = await prisma.user.create({
        data: { orgId: org.id, clerkUser: `user_${ns}`, email: `${ns}@test.local`, name: 'hs2' },
      });
      await prisma.integrationConfig.create({
        data: {
          orgId: org.id,
          type: 'hubspot',
          name: 'hubspot-migration',
          credentials: { encrypted: 'ciphertext' },
        },
      });
      const job = await prisma.migrationJob.create({
        data: {
          orgId: org.id,
          userId: user.id,
          source: 'HUBSPOT_OAUTH',
          status: 'RUNNING',
          totalRows: 2,
          processedRows: 0,
          startedAt: new Date(),
          meta: { entityType: 'companies', attemptId: ATTEMPT },
        },
      });
      const fetchMock = vi.fn(async (url: string) => {
        const after = new URL(String(url)).searchParams.get('after');
        const cursor = after === 'cursor-2' ? 'cursor-3' : 'cursor-2';
        const id = after === 'cursor-2' ? '2' : '1';
        return new Response(
          JSON.stringify({
            results: [{ id, properties: { name: `Acme ${id} ${ns}` } }],
            paging: { next: { after: cursor } },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      });
      vi.stubGlobal('fetch', fetchMock);
      const queued: Array<{ hubspotAfter?: string }> = [];
      let enqueued = 0;
      const deps: MigrationChunkDeps = {
        readRows: async () => null,
        enqueueChunk: async (_name, data) => {
          enqueued += 1;
          queued.push(data);
          if (enqueued === 2) throw new Error('queue down');
        },
        enqueueIntel: async () => undefined,
        env: { ACCOUNT_INTEL_IMPORT_ENRICH: 'false' },
      };
      const first = {
        migrationJobId: job.id,
        orgId: org.id,
        userId: user.id,
        source: 'HUBSPOT_OAUTH' as const,
        entityType: 'companies',
        chunkOffset: 0,
        chunkSize: 100,
        totalRows: 2,
        mappings: { name: 'company.name' },
        dedupStrategy: 'update' as const,
        attemptId: ATTEMPT,
      };
      const log = { info: () => undefined, warn: () => undefined };
      await processMigrationChunk(first, deps, log);
      expect(enqueued).toBe(1);
      const second = queued[0];
      expect(second?.hubspotAfter).toBe('cursor-2');
      await expect(processMigrationChunk(second as typeof first, deps, log)).rejects.toThrow(/queue down/);
      const failed = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(failed.status).toBe('RUNNING');
      expect(failed.processedRows).toBeGreaterThan(0);
      await processMigrationChunk(second as typeof first, deps, log);
      expect(enqueued).toBe(3);
      expect(queued[2]?.hubspotAfter).toBe('cursor-3');
      const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(stored.status).toBe('RUNNING');
    } finally {
      await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
    }
  });
});

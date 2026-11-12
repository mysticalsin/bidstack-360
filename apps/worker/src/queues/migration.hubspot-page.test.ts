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
});

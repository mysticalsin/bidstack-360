// WHY: a chunk holds migration_jobs FOR UPDATE for the whole import
// transaction. Cancel used to wait on that lock. The 120s transaction
// timeout does not cancel the blocked statement, so Cancel must answer
// while the lock is still held.

import { prisma } from '@bidstack/db';
import { expect } from 'vitest';

import { purgeAuditRows } from '../test-support/purge-audit-rows.js';
import { makeMigrationsTestContext } from './migrations.test-helpers.js';

const { ctx, skipIfNoDb, createJob } = makeMigrationsTestContext();

/** Longer than the handler's 2s lock wait. Far shorter than the chunk's 120s transaction. */
const CANCEL_RESPONSE_BOUND_MS = 5_000;

skipIfNoDb(
  'returns within CANCEL_RESPONSE_BOUND_MS while a chunk holds the job row lock',
  async () => {
    const job = await createJob({ status: 'RUNNING' });
    let releaseLock!: () => void;
    const released = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    let lockHeld!: () => void;
    const held = new Promise<void>((resolve) => {
      lockHeld = resolve;
    });

    const chunk = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM migration_jobs WHERE id = ${job.id}::uuid FOR UPDATE`;
        lockHeld();
        await released;
      },
      { maxWait: 5_000, timeout: 20_000 },
    );

    await held;
    const pending = ctx.server.inject({
      method: 'DELETE',
      url: `/api/v1/migrations/${job.id}/cancel`,
    });
    let timeout: NodeJS.Timeout | undefined;
    try {
      const started = Date.now();
      const outcome = await Promise.race([
        pending.then((res) => ({
          kind: 'response' as const,
          res,
          ms: Date.now() - started,
        })),
        new Promise<{ kind: 'timeout'; ms: number }>((resolve) => {
          timeout = setTimeout(
            () => resolve({ kind: 'timeout', ms: Date.now() - started }),
            CANCEL_RESPONSE_BOUND_MS,
          );
        }),
      ]);

      expect(outcome.kind).toBe('response');
      if (outcome.kind !== 'response') return;
      expect(outcome.ms).toBeLessThanOrEqual(CANCEL_RESPONSE_BOUND_MS);
      expect(outcome.res.statusCode).toBe(200);
      expect(outcome.res.json<{ status: string }>().status).toBe('RUNNING');

      const mark = await prisma.auditLog.findFirst({
        where: { targetId: job.id, action: 'migration.cancel.requested' },
        select: { id: true },
      });
      expect(mark).not.toBeNull();
      const during = await prisma.migrationJob.findUnique({
        where: { id: job.id },
        select: { status: true },
      });
      expect(during?.status).toBe('RUNNING');
    } finally {
      if (timeout) clearTimeout(timeout);
      releaseLock();
      await chunk;
      await pending;
      await purgeAuditRows({
        where: { targetId: job.id, action: 'migration.cancel.requested' },
      });
    }
  },
);

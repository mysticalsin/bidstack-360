/**
 * AI audit retention purge worker.
 *
 * Queue: ai-audit-retention (defined in @bidstack/shared AI_AUDIT_RETENTION)
 *
 * WHY: EU AI Act Art. 50 + GDPR Art. 22 require an AI-invocation audit log, but
 * GDPR storage-limitation (Art. 5(1)(e)) requires it NOT be kept indefinitely.
 * This is the real implementation of the previously comment-only
 * 'rfp.audit-cleanup' 90-day retention: it deletes ai_invocations rows older
 * than AI_AUDIT_RETENTION_DAYS, in bounded batches, on a daily cron.
 *
 * Coexistence with audit immutability: AuditLog mutations are blocked by the
 * Prisma $use middleware (packages/db audit-immutability). This purge targets
 * the ai_invocations TABLE via $executeRaw, which bypasses $use middleware — the
 * single, explicit allowed delete path for retention. (Raw SQL, not the
 * generated AiInvocation model, because the $use-exempt delete path must be
 * explicit.) Operational prerequisite: the ai_invocations table is created by
 * migration 20260527000000_rfp_vector_indexes — deploy that migration before/
 * with this worker; the purge guards with to_regclass and no-ops if it is absent.
 */

import { Worker, Queue, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { prisma } from '@bidstack/db';
import { AI_AUDIT_RETENTION } from '@bidstack/shared';

// Retention window in days. Default 90. Pure + exported so the env coercion is
// unit-tested (0 / negative / garbage all fall back to 90).
export function resolveRetentionDays(raw: string | undefined): number {
  const n = parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 90;
}
const RETENTION_DAYS = resolveRetentionDays(process.env.AI_AUDIT_RETENTION_DAYS);

// Daily at 03:30 UTC by default — off-peak, after the 03:00 calendar sweeps.
// Validate to a 5-field cron so a malformed env var can't crash worker boot;
// fall back to the default (a mismatch is surfaced in startAiAuditRetention).
const FIVE_FIELD_CRON = /^\S+(\s+\S+){4}$/;
const RAW_RETENTION_CRON = (process.env.AI_AUDIT_RETENTION_CRON ?? '').trim();
const RETENTION_CRON = FIVE_FIELD_CRON.test(RAW_RETENTION_CRON) ? RAW_RETENTION_CRON : '30 3 * * *';

// Per-batch delete cap. Each batch is its own short transaction so row locks are
// released before the next slice, keeping the purge from contending with live
// audit inserts on the table.
const PURGE_BATCH = 5_000;

// Hard cap on batches per run so a runaway backlog can't hold a worker slot for
// hours — the next daily run picks up whatever remains.
const MAX_BATCHES = 1_000;

export interface AiAuditRetentionResult {
  retentionDays: number;
  cutoff: string;
  rowsPurged: number;
  batches: number;
  truncated: boolean;
}

/**
 * Delete ai_invocations rows older than the retention cutoff in bounded batches.
 *
 * WHY ctid + LIMIT: a single table-wide DELETE takes row locks on every matching
 * row for the whole statement; on this append-heavy table that is a long lock
 * window contending with live inserts. The qualifying set only shrinks (new rows
 * have created_at > cutoff), so the loop terminates.
 */
export async function runAiAuditRetentionPass(
  log: pino.Logger,
): Promise<AiAuditRetentionResult> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1_000);
  let rowsPurged = 0;
  let batches = 0;
  let truncated = false;

  // Guard: if the migration that creates ai_invocations hasn't run in this
  // environment, no-op with a warning instead of throwing every night.
  const reg = await prisma.$queryRaw<Array<{ reg: string | null }>>`
    SELECT to_regclass('ai_invocations') AS reg
  `;
  if (!reg[0]?.reg) {
    log.warn('ai_invocations table not present — skipping retention purge (run migrations)');
    return { retentionDays: RETENTION_DAYS, cutoff: cutoff.toISOString(), rowsPurged, batches, truncated };
  }

  for (;;) {
    const deleted = await prisma.$executeRaw`
      DELETE FROM ai_invocations
      WHERE ctid IN (
        SELECT ctid FROM ai_invocations
        WHERE created_at < ${cutoff}
        LIMIT ${PURGE_BATCH}
      )
    `;
    rowsPurged += deleted;
    batches += 1;
    if (deleted < PURGE_BATCH) break;
    if (batches >= MAX_BATCHES) {
      truncated = true;
      log.warn(
        { batches, rowsPurged },
        'ai-audit retention hit MAX_BATCHES — remainder deferred to next run',
      );
      break;
    }
  }

  return { retentionDays: RETENTION_DAYS, cutoff: cutoff.toISOString(), rowsPurged, batches, truncated };
}

let queueSingleton: Queue | null = null;

function getRetentionQueue(connection: IORedis): Queue {
  if (!queueSingleton) {
    queueSingleton = new Queue(AI_AUDIT_RETENTION.name, {
      connection,
      defaultJobOptions: AI_AUDIT_RETENTION.defaultJobOptions,
    });
  }
  return queueSingleton;
}

export async function startAiAuditRetention(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
): Promise<void> {
  const queue = getRetentionQueue(connection);
  queues.push(queue);

  const worker = new Worker(
    AI_AUDIT_RETENTION.name,
    async (job: Job) => {
      const childLog = log.child({ jobId: job.id, jobName: job.name });
      childLog.info({ retentionDays: RETENTION_DAYS }, 'ai-audit retention purge started');
      const result = await runAiAuditRetentionPass(childLog);
      childLog.info(result, 'ai-audit retention purge complete');
      return result;
    },
    {
      connection,
      concurrency: 1, // single-writer purge; no benefit to parallelism
    },
  );

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'ai-audit retention purge failed');
  });

  workers.push(worker);

  if (RAW_RETENTION_CRON && RAW_RETENTION_CRON !== RETENTION_CRON) {
    log.warn(
      { provided: RAW_RETENTION_CRON, using: RETENTION_CRON },
      'AI_AUDIT_RETENTION_CRON is not a valid 5-field cron — using default',
    );
  }

  // Drop any stale repeatable on a different pattern so changing the cron doesn't
  // leave the old schedule running duplicate daily purges.
  for (const r of await queue.getRepeatableJobs()) {
    if (r.name === 'ai-audit.retention' && r.pattern !== RETENTION_CRON) {
      await queue.removeRepeatableByKey(r.key);
    }
  }

  // Stable jobId prevents duplicate scheduled jobs accumulating across restarts.
  await queue.add(
    'ai-audit.retention',
    {},
    {
      repeat: { pattern: RETENTION_CRON },
      jobId: 'ai-audit-retention-scheduled',
    },
  );

  log.info(
    { retentionDays: RETENTION_DAYS, cron: RETENTION_CRON },
    'ai-audit retention worker started (daily purge registered)',
  );
}

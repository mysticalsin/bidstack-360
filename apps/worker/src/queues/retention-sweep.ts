/**
 * Retention sweep worker, one pass per day across every data class in
 * RETENTION_POLICIES (packages/db/src/compliance/retention.ts).
 *
 * Queue: retention-sweep (defined in @bidstack/shared RETENTION_SWEEP)
 *
 * Periods come from RETENTION_<CLASS>_DAYS env vars. The sweep only counts
 * (dry run report in the job result and logs) until an operator sets
 * RETENTION_MODE=enforce. ai_invocations keeps its own job
 * (ai-audit-retention.ts).
 */

import { Worker, Queue, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { resolveRetentionConfig, retentionPrisma, runRetentionSweep } from '@bidstack/db';
import { RETENTION_SWEEP } from '@bidstack/shared';

const FIVE_FIELD_CRON = /^\S+(\s+\S+){4}$/;
const RAW_CRON = (process.env.RETENTION_SWEEP_CRON ?? '').trim();
const SWEEP_CRON = FIVE_FIELD_CRON.test(RAW_CRON) ? RAW_CRON : '45 3 * * *';

export async function runRetentionJob(
  log: pino.Logger,
  env: Record<string, string | undefined> = process.env,
): Promise<Awaited<ReturnType<typeof runRetentionSweep>>> {
  const { mode } = resolveRetentionConfig(env);
  const out = await runRetentionSweep(retentionPrisma(), { dryRun: mode !== 'enforce', env });
  log.info(out, out.dryRun ? 'retention sweep report (dry run)' : 'retention sweep enforced');
  return out;
}

export async function startRetentionSweep(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
): Promise<void> {
  const queue = new Queue(RETENTION_SWEEP.name, {
    connection,
    defaultJobOptions: RETENTION_SWEEP.defaultJobOptions,
  });
  queues.push(queue);

  const worker = new Worker(
    RETENTION_SWEEP.name,
    (job: Job) => runRetentionJob(log.child({ jobId: job.id })),
    { connection, concurrency: 1 },
  );
  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'retention sweep failed');
  });
  workers.push(worker);

  if (RAW_CRON && RAW_CRON !== SWEEP_CRON) {
    log.warn(
      { provided: RAW_CRON, using: SWEEP_CRON },
      'RETENTION_SWEEP_CRON is not a valid 5-field cron, using default',
    );
  }
  for (const r of await queue.getRepeatableJobs()) {
    if (r.name === 'retention.sweep' && r.pattern !== SWEEP_CRON)
      await queue.removeRepeatableByKey(r.key);
  }
  await queue.add(
    'retention.sweep',
    {},
    { repeat: { pattern: SWEEP_CRON }, jobId: 'retention-sweep-scheduled' },
  );
  log.info(
    { cron: SWEEP_CRON, mode: resolveRetentionConfig(process.env).mode },
    'retention sweep worker started',
  );
}

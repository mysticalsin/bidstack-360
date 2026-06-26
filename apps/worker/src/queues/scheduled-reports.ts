/**
 * Scheduled analytics-report worker.
 *
 * Queue: report.scheduled (local config — packages/shared is owned by another
 * agent this run).
 *
 * A repeatable job (hourly) scans active analytics reports whose `schedule`
 * resolves to a cadence (see scheduled-reports.helpers.ts) and that are due, and
 * for each: advances lastRunAt via compare-and-swap, records an
 * AnalyticsReportRun row, and notifies the report owner that the scheduled run
 * is ready.
 *
 * IDEMPOTENCY: lastRunAt is advanced with a CAS (updateMany WHERE lastRunAt =
 * observed) BEFORE any side effect — a concurrent/overlapping scan loses the CAS
 * (count 0) and skips, so a report is never double-run within its cadence.
 * Mirrors claimScheduleRun in workflow-schedule.ts.
 *
 * ── SEAM (honest limitation) ────────────────────────────────────────────────
 * The actual report query is compiled + executed by `compileAnalyticsQuery` /
 * `runPersistedReport` in apps/api/src/lib/analytics-engine.ts +
 * routes/analytics-reports.helpers.ts. That code (and the security-critical
 * field allowlist in analytics-fields.ts) lives ONLY in apps/api — it is not a
 * @bidstack/* package, and the worker does not (and per the app-boundary
 * convention must not) depend on apps/api. Re-implementing the SQL compiler here
 * would duplicate ~400 lines of injection-sensitive logic, which the brief
 * explicitly forbids.
 *
 * So this worker drives the scheduling lifecycle (detect due → CAS → run row →
 * notify) but records each run with status 'pending' and a note that headless
 * execution is pending the engine being extracted to a shared package. FOLLOW-UP
 * (tracked in the structured report): move analytics-engine.ts + analytics-
 * fields.ts into a @bidstack/* package so both apps/api and apps/worker compile
 * and execute the query from one source, then have this worker call it and write
 * status 'done' with the result. Email delivery is a separate follow-up (no
 * sender exists in the worker today; the in-app notification is the deliverable).
 */

import { Queue, Worker, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { prisma } from '@bidstack/db';

import {
  SCHEDULED_REPORTS_SCAN_INTERVAL_MINUTES,
  isReportDue,
} from './scheduled-reports.helpers.js';

const QUEUE_NAME = 'report.scheduled';

const SCAN_INTERVAL_MINUTES = SCHEDULED_REPORTS_SCAN_INTERVAL_MINUTES;

/**
 * Upper bound on reports examined per scan. Scheduled reports are org-curated
 * and low-volume; a deterministic order pages any backlog consistently.
 */
const SCAN_BATCH_SIZE = 500;

/** BullMQ job options — local mirror of the shared QueueConfig shape. */
const JOB_OPTIONS = {
  attempts: 2,
  backoff: { type: 'fixed' as const, delay: 30_000 },
  removeOnComplete: { age: 86_400, count: 50 },
  removeOnFail: { age: 86_400 * 7, count: 500 },
};

/**
 * Note persisted on the run row + carried in the notification body. Names the
 * seam so it is visible in-product, not just in code comments.
 */
const PENDING_EXECUTION_NOTE =
  'Scheduled run queued. Headless query execution is pending the analytics engine being shared with the worker; open the report to run it now.';

interface DueReport {
  id: string;
  orgId: string;
  name: string;
  ownerId: string;
  schedule: string | null;
  lastRunAt: Date | null;
}

/**
 * Atomically claim a report run via compare-and-swap on the observed lastRunAt.
 * Only the scan whose WHERE still matches the observed value wins (count === 1);
 * an overlapping scan that already advanced lastRunAt sees count === 0 and skips.
 */
async function claimReportRun(
  reportId: string,
  orgId: string,
  observedLastRunAt: Date | null,
  now: Date,
): Promise<boolean> {
  const { count } = await prisma.analyticsReport.updateMany({
    where: { id: reportId, orgId, deletedAt: null, lastRunAt: observedLastRunAt },
    data: { lastRunAt: now },
  });
  return count === 1;
}

/** Record the run row + notify the owner. Run AFTER the claim succeeds. */
async function recordAndNotify(report: DueReport, log: pino.Logger): Promise<void> {
  // status 'pending' + note: the schedule fired and the lifecycle advanced, but
  // the actual query execution is the documented seam (see file header).
  await prisma.analyticsReportRun.create({
    data: {
      orgId: report.orgId,
      reportId: report.id,
      status: 'pending',
      // Seam note lives in `result` (run metadata), NOT `error`: status 'pending'
      // already marks "not executed yet", and a non-null `error` would make a
      // healthy queued run read as failed in the runs UI.
      result: { note: PENDING_EXECUTION_NOTE },
    },
  });

  await prisma.notification.create({
    data: {
      orgId: report.orgId,
      userId: report.ownerId,
      // 'system' is the only non-gated NotificationType the worker may emit
      // without editing @bidstack/shared (see bid-deadline-alerts.ts).
      type: 'system',
      title: `Scheduled report ready: ${report.name}`,
      body: PENDING_EXECUTION_NOTE,
      entityType: 'analytics_report',
      entityId: report.id,
      url: `/reports/${report.id}`,
    },
  });

  log.info({ reportId: report.id }, 'scheduled report run recorded + owner notified');
}

async function scanScheduledReports(log: pino.Logger): Promise<void> {
  const now = new Date();
  const reports = await prisma.analyticsReport.findMany({
    where: { deletedAt: null, schedule: { not: null } },
    // Deterministic order so a >batch backlog is paged consistently scan-to-scan.
    orderBy: [{ lastRunAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
    take: SCAN_BATCH_SIZE,
    select: { id: true, orgId: true, name: true, ownerId: true, schedule: true, lastRunAt: true },
  });

  const due = reports.filter((r) => isReportDue(r.schedule, r.lastRunAt, now));
  if (due.length === 0) {
    log.debug('no scheduled reports due');
    return;
  }

  let ran = 0;
  for (const report of due) {
    try {
      // Claim BEFORE side effects — if another scan already advanced lastRunAt,
      // we lose the CAS and skip rather than double-run.
      const claimed = await claimReportRun(report.id, report.orgId, report.lastRunAt, now);
      if (!claimed) {
        log.debug({ reportId: report.id }, 'scheduled report already claimed by a concurrent scan');
        continue;
      }
      await recordAndNotify(report, log);
      ran += 1;
    } catch (err) {
      // Per-report isolation — one failure must not stop the rest of the scan.
      log.error({ err, reportId: report.id }, 'scheduled report run threw');
    }
  }

  log.info({ due: due.length, ran }, 'scheduled-reports scan complete');
}

export async function startScheduledReports(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
): Promise<void> {
  const queue = new Queue(QUEUE_NAME, { connection, defaultJobOptions: JOB_OPTIONS });
  queues.push(queue);

  const worker = new Worker(
    QUEUE_NAME,
    (_job: Job) => scanScheduledReports(log.child({ worker: QUEUE_NAME })),
    { connection, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    log.warn({ jobId: job?.id, err: err.message }, 'scheduled-reports scan failed');
  });

  workers.push(worker);

  // Idempotent jobId so a restart does not stack duplicate repeatables.
  await queue.add(
    'scheduled-reports-scan',
    {},
    { repeat: { every: SCAN_INTERVAL_MINUTES * 60_000 }, jobId: 'scheduled-reports-scan' },
  );

  log.info({ queue: QUEUE_NAME, intervalMinutes: SCAN_INTERVAL_MINUTES },
    'scheduled-reports worker started (repeatable scan registered)');
}

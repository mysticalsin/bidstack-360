/**
 * Task-due + KAM-staleness alert worker.
 *
 * Queue: task.kam-alerts (local config, mirroring bid-deadline-alerts.ts —
 * packages/shared queue config stays reserved for cross-service producers).
 *
 * ONE repeatable job (hourly, same cadence as bid-deadline-alerts.ts) runs two
 * bounded, org-scoped scans per tick:
 *   (a) Tasks due within 24h or overdue (open/in_progress/blocked, has an
 *       assignee) -> notify the assignee. Gated by the assignee's
 *       `taskDueSoon` preference, checked inline (type 'task_due').
 *   (b) KamInitiative rows with no activity in >= 14 days (docs/KAM-PLAN.md
 *       §5 staleness rule; deferred at PROGRESS.md 2026-06-23) -> notify the
 *       owner. Type 'system' (no dedicated pref exists for this nudge yet).
 *
 * Opportunity/bid deadline-approaching alerts are intentionally NOT
 * duplicated here — apps/worker/src/queues/bid-deadline-alerts.ts already
 * covers that (7/3/1-day cadence, tested, in production). Rebuilding it with
 * a different 48h window here would fire two different notifications for the
 * same deadline, which is the exact alert-fatigue failure this worker's own
 * dedupe design exists to prevent. See docs/solutions/ for the writeup.
 *
 * IDEMPOTENCY: each (entity, UTC-day) alert carries a deterministic dedupe URL
 * (task-kam-alerts.helpers.ts). Before creating, the worker checks whether a
 * notification with that exact url already exists for the recipient — so a
 * same-day re-run of the hourly scan never double-notifies, while a task/
 * initiative that is STILL due/stale the next day legitimately gets a fresh
 * nudge (unlike bid-deadline-alerts' once-ever per-threshold key).
 *
 * NO DB-level backstop (unlike bid-deadline-alerts' `notifications_deadline_
 * dedupe_uq` partial unique index + P2002 catch) — existence-check only.
 * Known, accepted gap, not an oversight: apps/worker runs 2-6 replicas in
 * production (infra/azure/main.bicep `workerApp.scale`), same topology
 * bid-deadline-alerts was hardened against, so this IS weaker than its
 * sibling. `concurrency: 1` + a single repeatable jobId only guarantee no
 * double-insert within one worker process / one ticked job instance — they do
 * NOT rule out a retried attempt (JOB_OPTIONS: attempts 2, 30s backoff) being
 * picked up by a different replica than the one that partially ran it, racing
 * a fresh tick's scan of the same row. Accepted without a migration for now
 * because: (a) the trigger is a rare insert-time failure, not routine
 * concurrency; (b) the blast radius of a duplicate here is one extra
 * notification (annoying, not a correctness/data-loss bug); (c) a real
 * migration on this Windows dev host is its own risk (Prisma DLL locks) and
 * out of this fix's scope. Before this cron carries bid-deadline-alerts-level
 * traffic, mirror its partial unique index for these dedupe URL shapes
 * (`/tasks?...` / `/kam?...`).
 *
 * NOTE on the pref check: apps/api's createNotification (the API-side seam)
 * is not importable here — apps/worker and apps/api are separate packages
 * with no shared service module for this. Mirrors bid-deadline-alerts.ts,
 * which writes `prisma.notification.create` directly for the same reason;
 * this worker additionally re-implements the one pref check it needs
 * (taskDueSoon) inline, matching createNotification's own semantics: no pref
 * row = deliver (default), only an explicit `false` suppresses.
 */

import { Queue, Worker, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { prisma, TaskStatus, InitiativeStage } from '@bidstack/db';

import {
  daysUntilDue,
  daysSince,
  isTaskDueOrOverdue,
  isInitiativeStale,
  KAM_STALE_THRESHOLD_DAYS,
  utcDayKey,
  taskDueDedupeUrl,
  initiativeStaleDedupeUrl,
} from './task-kam-alerts.helpers.js';

const QUEUE_NAME = 'task.kam-alerts';

/** Hourly scan — matches bid-deadline-alerts.ts; deadlines/staleness move in whole days. */
const SCAN_INTERVAL_MINUTES = 60;

/** Upper bound on rows examined per scan, per entity kind — keeps one tick's load bounded. */
const SCAN_BATCH_SIZE = 1000;

const JOB_OPTIONS = {
  attempts: 2,
  backoff: { type: 'fixed' as const, delay: 30_000 },
  removeOnComplete: { age: 86_400, count: 50 },
  removeOnFail: { age: 86_400 * 7, count: 500 },
};

const OPEN_TASK_STATUSES = [TaskStatus.open, TaskStatus.in_progress, TaskStatus.blocked];
// Terminal initiative stages don't need a staleness nudge: 'dropped' is closed
// out and 'opportunity' has already handed off to the Opportunity pipeline
// (which gets its own deadline alerts via bid-deadline-alerts.ts).
const ACTIVE_INITIATIVE_STAGES = [InitiativeStage.initiative, InitiativeStage.lead];

interface DueTask {
  id: string;
  orgId: string;
  title: string;
  assigneeId: string;
}

/**
 * Create the task-due alert IF the assignee has not opted out and it was not
 * already sent today. Returns true when a new notification was written.
 */
async function alertTaskIfNew(task: DueTask, daysUntil: number, url: string): Promise<boolean> {
  // No pref row = deliver (default); only an explicit opt-out suppresses —
  // mirrors createNotification's own GATED_BY_PREF semantics.
  const pref = await prisma.notificationPref.findUnique({
    where: { userId: task.assigneeId },
    select: { taskDueSoon: true },
  });
  if (pref && pref.taskDueSoon === false) return false;

  const existing = await prisma.notification.findFirst({
    where: { orgId: task.orgId, userId: task.assigneeId, url },
    select: { id: true },
  });
  if (existing) return false;

  const label = daysUntil <= 0 ? 'overdue' : 'due tomorrow';
  await prisma.notification.create({
    data: {
      orgId: task.orgId,
      userId: task.assigneeId,
      type: 'task_due',
      title: `Task ${label}: ${task.title}`,
      body: `"${task.title}" is ${label}.`,
      entityType: 'task',
      entityId: task.id,
      url,
    },
  });
  return true;
}

export async function scanTaskDueAlerts(now: Date, log: pino.Logger): Promise<number> {
  const dayKey = utcDayKey(now);
  // Bound the query itself (not just the in-memory isTaskDueOrOverdue filter)
  // to "due tomorrow or earlier" — mirrors bid-deadline-alerts.ts's windowEnd.
  // Without this, a large ancient-overdue backlog could fill the whole
  // SCAN_BATCH_SIZE and starve genuinely-urgent "due tomorrow" tasks out of
  // the batch even though the dueDate-asc order already favors them.
  const windowEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  const tasks = await prisma.task.findMany({
    where: {
      deletedAt: null,
      status: { in: OPEN_TASK_STATUSES },
      assigneeId: { not: null },
      dueDate: { not: null, lte: windowEnd },
    },
    orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
    take: SCAN_BATCH_SIZE,
    select: { id: true, orgId: true, title: true, dueDate: true, assigneeId: true },
  });

  let created = 0;
  for (const task of tasks) {
    if (!task.dueDate || !task.assigneeId) continue;
    const daysUntil = daysUntilDue(task.dueDate, now);
    if (!isTaskDueOrOverdue(daysUntil)) continue;
    try {
      const scanned: DueTask = {
        id: task.id,
        orgId: task.orgId,
        title: task.title,
        assigneeId: task.assigneeId,
      };
      if (await alertTaskIfNew(scanned, daysUntil, taskDueDedupeUrl(task.id, dayKey))) created += 1;
    } catch (err) {
      log.error({ err, taskId: task.id }, 'task-due alert failed');
    }
  }
  return created;
}

export async function scanKamStaleness(now: Date, log: pino.Logger): Promise<number> {
  const dayKey = utcDayKey(now);
  // Bound the query to rows that are ALREADY stale (>= threshold days idle) —
  // same rationale as scanTaskDueAlerts' windowEnd: keeps the batch full of
  // genuinely-actionable rows instead of fresh, non-stale initiatives.
  const staleThreshold = new Date(now.getTime() - KAM_STALE_THRESHOLD_DAYS * 86_400_000);
  const initiatives = await prisma.kamInitiative.findMany({
    where: {
      deletedAt: null,
      stage: { in: ACTIVE_INITIATIVE_STAGES },
      ownerId: { not: null },
      lastActivityAt: { lte: staleThreshold },
    },
    orderBy: [{ lastActivityAt: 'asc' }, { id: 'asc' }],
    take: SCAN_BATCH_SIZE,
    select: { id: true, orgId: true, title: true, lastActivityAt: true, ownerId: true },
  });

  let created = 0;
  for (const initiative of initiatives) {
    if (!initiative.ownerId) continue;
    const stale = daysSince(initiative.lastActivityAt, now);
    if (!isInitiativeStale(stale)) continue;
    const url = initiativeStaleDedupeUrl(initiative.id, dayKey);
    try {
      const existing = await prisma.notification.findFirst({
        where: { orgId: initiative.orgId, userId: initiative.ownerId, url },
        select: { id: true },
      });
      if (existing) continue;
      await prisma.notification.create({
        data: {
          orgId: initiative.orgId,
          userId: initiative.ownerId,
          type: 'system',
          title: `Account going stale: ${initiative.title}`,
          body: `No activity on "${initiative.title}" in ${stale} days.`,
          entityType: 'kam_initiative',
          entityId: initiative.id,
          url,
        },
      });
      created += 1;
    } catch (err) {
      log.error({ err, initiativeId: initiative.id }, 'KAM staleness alert failed');
    }
  }
  return created;
}

async function runScan(log: pino.Logger): Promise<void> {
  const now = new Date();
  const [taskAlerts, staleAlerts] = await Promise.all([
    scanTaskDueAlerts(now, log),
    scanKamStaleness(now, log),
  ]);
  log.info({ taskAlerts, staleAlerts }, 'task-kam-alerts scan complete');
}

export async function startTaskKamAlerts(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
): Promise<void> {
  const queue = new Queue(QUEUE_NAME, { connection, defaultJobOptions: JOB_OPTIONS });
  queues.push(queue);

  const worker = new Worker(QUEUE_NAME, (_job: Job) => runScan(log.child({ worker: QUEUE_NAME })), {
    connection,
    concurrency: 1,
  });

  worker.on('failed', (job, err) => {
    log.warn({ jobId: job?.id, err: err.message }, 'task-kam-alerts scan failed');
  });

  workers.push(worker);

  // Idempotent jobId so a restart does not stack duplicate repeatables.
  await queue.add(
    'task-kam-alerts-scan',
    {},
    { repeat: { every: SCAN_INTERVAL_MINUTES * 60_000 }, jobId: 'task-kam-alerts-scan' },
  );

  log.info(
    { queue: QUEUE_NAME, intervalMinutes: SCAN_INTERVAL_MINUTES },
    'task-kam-alerts worker started (repeatable scan registered)',
  );
}

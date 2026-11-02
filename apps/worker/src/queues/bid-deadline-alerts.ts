/**
 * Bid-deadline alert worker.
 *
 * Queue: bid.deadline-alerts (local config — packages/shared is owned by another
 * agent this run, so the queue config lives here, not in @bidstack/shared).
 *
 * A repeatable job (hourly) scans open, non-deleted Opportunities whose dueDate
 * is within DEADLINE_THRESHOLD_DAYS (7 / 3 / 1 days) and, for the NEAREST crossed
 * threshold, creates one in-app notification for the opportunity owner. The copy
 * states the real days remaining; `threshold` is only the per-boundary dedupe
 * key, so an opp first seen already inside a tight window gets one accurate alert
 * (not 7d+3d+1d at once), and still receives each 7/3/1 boundary at most once.
 *
 * The same scan ALSO covers the overdue case (dueDate already passed): a single
 * once-ever alert per opportunity, distinct dedupe bucket from the 7/3/1
 * boundaries (see OVERDUE_DEDUPE_THRESHOLD) — missing the deadline entirely is
 * the single most important "deadline discipline" scenario, and there is no
 * double-notify risk since the 7/3/1 buckets never fire once daysUntil is
 * negative (thresholdsFor returns []).
 *
 * IDEMPOTENCY (no schema marker / migration): each (opportunity, threshold)
 * alert carries a deterministic dedupe URL (deadlineDedupeUrl). Before creating,
 * the worker checks whether a notification with that exact url already exists for
 * the owner — so the same boundary is never alerted twice, across scans or
 * restarts. The scan runs at concurrency 1 with a single repeatable, so there is
 * no concurrent double-insert to race.
 *
 * WHY a repeatable scan, not per-opp crons: deadlines are dense and constantly
 * changing; one bounded periodic scan avoids registering/unregistering N Bull
 * repeatables as opportunities are created, edited, won, or lost. Mirrors the
 * bounded, org-scoped, retry-safe shape of workflow-schedule.ts.
 */

import { Queue, Worker, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { prisma, OpportunityStage, Prisma } from '@bidstack/db';

import {
  DEADLINE_THRESHOLD_DAYS,
  OVERDUE_DEDUPE_THRESHOLD,
  daysUntilDue,
  deadlineDedupeUrl,
  dueInLabel,
  isOverdue,
  nearestCrossedThreshold,
  overdueByLabel,
  type DeadlineThresholdDay,
} from './bid-deadline-alerts.helpers.js';

const QUEUE_NAME = 'bid.deadline-alerts';

/** Hourly scan — deadlines move in whole days, so sub-hour resolution is noise. */
const SCAN_INTERVAL_MINUTES = 60;

/**
 * Upper bound on opportunities examined per scan. Keeps one scan's memory and DB
 * load bounded for a large tenant; a deterministic order (dueDate asc, id asc)
 * means the most-urgent deadlines are always covered first and a >batch backlog
 * is paged consistently scan-to-scan.
 */
const SCAN_BATCH_SIZE = 1000;

/**
 * How far past its due date the scan still looks for a NOT-YET-ALERTED overdue
 * opportunity. Bounded (not unbounded) so a large tenant's old, still-open,
 * long-overdue backlog can't grow the scan query without limit; 30 days covers
 * the realistic window in which a missed-deadline nudge is still actionable —
 * an opp overdue longer than that has almost certainly already been
 * renegotiated, closed, or otherwise handled outside this alert. Once alerted,
 * the existence check makes re-scanning a within-window overdue row cheap
 * regardless (indexed by notifications_deadline_dedupe_uq).
 */
const OVERDUE_LOOKBACK_DAYS = 30;

/** BullMQ job options — local mirror of the shared QueueConfig shape. */
const JOB_OPTIONS = {
  attempts: 2,
  backoff: { type: 'fixed' as const, delay: 30_000 },
  removeOnComplete: { age: 86_400, count: 50 },
  removeOnFail: { age: 86_400 * 7, count: 500 },
};

/** Closed stages (won/lost) — their opportunities no longer need deadline alerts. */
const CLOSED_STAGES = [OpportunityStage.closed_won, OpportunityStage.closed_lost];

interface ScannedOpp {
  id: string;
  orgId: string;
  name: string;
  customer: string;
  dueDate: Date;
  ownerId: string;
}

/**
 * Create the alert for one (opp, threshold) IF it does not already exist. The
 * copy uses the real `daysUntil` (not the bucket boundary), while `threshold` is
 * the per-boundary dedupe discriminator. The existence check is the fast path;
 * the DB-level guarantee is the partial unique index
 * `notifications_deadline_dedupe_uq` on (org_id, user_id, url) for deadline urls,
 * so a concurrent scan that wins the race surfaces P2002 (caught → false) rather
 * than inserting a duplicate. Returns true when a new notification was written.
 */
async function alertIfNew(
  opp: ScannedOpp,
  threshold: DeadlineThresholdDay,
  daysUntil: number,
): Promise<boolean> {
  const url = deadlineDedupeUrl(opp.id, threshold);
  const existing = await prisma.notification.findFirst({
    where: { orgId: opp.orgId, userId: opp.ownerId, url },
    select: { id: true },
  });
  if (existing) return false;

  const label = dueInLabel(daysUntil);
  try {
    await prisma.notification.create({
      data: {
        orgId: opp.orgId,
        userId: opp.ownerId,
        // 'system' is the only non-gated NotificationType the worker may emit
        // without editing @bidstack/shared (the Zod enum gates the API response
        // serializer). entityType/url distinguish deadline alerts from other
        // system notifications.
        type: 'system',
        title: `Bid deadline ${label}: ${opp.name}`,
        body: `${opp.customer} — proposal for "${opp.name}" is due ${label}.`,
        entityType: 'opportunity',
        entityId: opp.id,
        url,
      },
    });
    return true;
  } catch (err) {
    // A concurrent scan already wrote this exact (opp, threshold) alert and won
    // the unique-index race — idempotent: treat as already-alerted, not an error.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return false;
    }
    throw err;
  }
}

/**
 * Create the once-ever overdue alert for one opportunity IF it does not
 * already exist. Mirrors alertIfNew's existence-check + P2002 shape but keyed
 * on OVERDUE_DEDUPE_THRESHOLD instead of a real 7/3/1 boundary — a distinct
 * dedupe URL, so it can never collide with (or suppress) an on-time alert.
 * `daysUntil` is negative here; the copy states how many days OVERDUE the opp
 * is, not "due in -3 days". Returns true when a new notification was written.
 */
async function alertOverdueIfNew(opp: ScannedOpp, daysUntil: number): Promise<boolean> {
  const url = deadlineDedupeUrl(opp.id, OVERDUE_DEDUPE_THRESHOLD);
  const existing = await prisma.notification.findFirst({
    where: { orgId: opp.orgId, userId: opp.ownerId, url },
    select: { id: true },
  });
  if (existing) return false;

  const label = overdueByLabel(-daysUntil);
  try {
    await prisma.notification.create({
      data: {
        orgId: opp.orgId,
        userId: opp.ownerId,
        // 'system' — see the matching comment on alertIfNew's create() above.
        type: 'system',
        title: `Bid deadline missed: ${opp.name}`,
        body: `${opp.customer} — proposal for "${opp.name}" is ${label}.`,
        entityType: 'opportunity',
        entityId: opp.id,
        url,
      },
    });
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return false;
    }
    throw err;
  }
}

async function scanDeadlines(log: pino.Logger): Promise<void> {
  const now = new Date();
  const maxThreshold = Math.max(...DEADLINE_THRESHOLD_DAYS);
  // dueDate is a Postgres `date`, so bound on the UTC day to match
  // daysUntilDue's basis. windowStart reaches OVERDUE_LOOKBACK_DAYS into the
  // past (to also catch not-yet-alerted overdue opps); windowEnd reaches the
  // widest on-time threshold into the future — keeps the scan set bounded on
  // both ends.
  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const windowStart = new Date(todayUTC.getTime() - OVERDUE_LOOKBACK_DAYS * 86_400_000);
  const windowEnd = new Date(todayUTC.getTime() + maxThreshold * 86_400_000);

  const opps = await prisma.opportunity.findMany({
    where: {
      deletedAt: null,
      stage: { notIn: CLOSED_STAGES },
      ownerId: { not: null },
      dueDate: { gte: windowStart, lte: windowEnd },
    },
    // Deterministic order: soonest deadlines first so a >batch backlog never
    // starves the most-urgent alerts.
    orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
    take: SCAN_BATCH_SIZE,
    select: {
      id: true,
      orgId: true,
      name: true,
      customer: true,
      dueDate: true,
      ownerId: true,
    },
  });

  let created = 0;
  for (const opp of opps) {
    // ownerId is non-null by the WHERE filter, but the select types it nullable.
    if (!opp.dueDate || !opp.ownerId) continue;
    const scanned: ScannedOpp = {
      id: opp.id,
      orgId: opp.orgId,
      name: opp.name,
      customer: opp.customer,
      dueDate: opp.dueDate,
      ownerId: opp.ownerId,
    };
    // Alert on the NEAREST crossed boundary only — emitting every crossed bucket
    // at once (an opp first seen already due tomorrow) would fire 7d+3d+1d
    // together. daysUntil only decreases, so a later scan crossing into a tighter
    // bucket fires that bucket via its own dedupe key → the intended 7→3→1 cadence.
    const daysUntil = daysUntilDue(scanned.dueDate, now);
    const threshold = nearestCrossedThreshold(daysUntil);
    // Overdue opps fall outside every 7/3/1 bucket (threshold === null) but
    // still need the single, distinct once-ever overdue alert — see the
    // module doc comment and alertOverdueIfNew.
    if (threshold === null && !isOverdue(daysUntil)) continue;
    try {
      if (threshold !== null) {
        if (await alertIfNew(scanned, threshold, daysUntil)) created += 1;
      } else if (await alertOverdueIfNew(scanned, daysUntil)) {
        created += 1;
      }
    } catch (err) {
      // Per-opp isolation — one failed insert must not abort the rest of the scan.
      log.error({ err, opportunityId: scanned.id, threshold }, 'bid-deadline alert failed');
    }
  }

  log.info({ scanned: opps.length, created }, 'bid-deadline scan complete');
}

export async function startBidDeadlineAlerts(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
): Promise<void> {
  const queue = new Queue(QUEUE_NAME, { connection, defaultJobOptions: JOB_OPTIONS });
  queues.push(queue);

  const worker = new Worker(
    QUEUE_NAME,
    (_job: Job) => scanDeadlines(log.child({ worker: QUEUE_NAME })),
    { connection, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    log.warn({ jobId: job?.id, err: err.message }, 'bid-deadline scan failed');
  });

  workers.push(worker);

  // Idempotent jobId so a restart does not stack duplicate repeatables.
  await queue.add(
    'bid-deadline-scan',
    {},
    { repeat: { every: SCAN_INTERVAL_MINUTES * 60_000 }, jobId: 'bid-deadline-scan' },
  );

  log.info({ queue: QUEUE_NAME, intervalMinutes: SCAN_INTERVAL_MINUTES },
    'bid-deadline alert worker started (repeatable scan registered)');
}

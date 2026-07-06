// Team workload / capacity aggregation — GET /analytics/workload.
//
// The bid lead's Monday-morning question: who is carrying how many live bids,
// how much weighted pipeline sits on each desk, which desks have overdue
// follow-ups, and whose bids close inside the next seven days. One org-scoped
// read returning per-owner rows. Money stays in micros (as strings so
// BigInt-sized sums never lose precision) — the web formats at the edge per
// the repo money convention.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { Prisma, prisma } from '@bidstack/db';

const WorkloadOwner = z.object({
  /** null = the unassigned bucket (open bids/tasks nobody owns). */
  ownerId: z.string().uuid().nullable(),
  /** null name+email with a non-null ownerId = a departed owner still holding bids. */
  name: z.string().nullable(),
  email: z.string().nullable(),
  openBids: z.number().int(),
  openValueMicros: z.string(),
  weightedValueMicros: z.string(),
  openTasks: z.number().int(),
  overdueTasks: z.number().int(),
  closingWithin7Days: z.number().int(),
});
type WorkloadOwnerRow = z.infer<typeof WorkloadOwner>;

const WorkloadResponse = z.object({
  generatedAt: z.string(),
  owners: z.array(WorkloadOwner),
});

interface BidAggRow {
  ownerId: string | null;
  openBids: number;
  openValueMicros: string;
  weightedValueMicros: string;
  closingWithin7Days: number;
}

/**
 * Open-bid aggregates per owner. Raw SQL because weighted pipeline is a
 * row-wise product (valueMicros × probability/100) reduced per group — not
 * expressible via prisma.groupBy — mirroring services/reports/funnel.service.ts.
 * "Open" matches that service's definition: stage not in the two closed states.
 * The 7-day window is [today, today+7) on the DB's date, matching the
 * dueWithinDays semantics of the opportunities list route.
 */
function aggregateBids(orgId: string): Promise<BidAggRow[]> {
  return prisma.$queryRaw<BidAggRow[]>(Prisma.sql`
    SELECT
      o.owner_id                             AS "ownerId",
      COUNT(*)::int                          AS "openBids",
      COALESCE(SUM(o.value_micros), 0)::text AS "openValueMicros",
      COALESCE(SUM(ROUND(o.value_micros * o.probability / 100.0)), 0)::text
                                             AS "weightedValueMicros",
      COUNT(*) FILTER (
        WHERE o.due_date >= CURRENT_DATE
          AND o.due_date < CURRENT_DATE + 7
      )::int                                 AS "closingWithin7Days"
    FROM opportunities o
    WHERE o.org_id = ${orgId}::uuid
      AND o.deleted_at IS NULL
      AND o.stage NOT IN ('closed_won', 'closed_lost')
    GROUP BY o.owner_id
  `);
}

interface TaskAgg {
  open: Map<string | null, number>;
  overdue: Map<string | null, number>;
}

/** Open (= not done) and overdue (= not done + past due) task counts per assignee. */
async function aggregateTasks(orgId: string): Promise<TaskAgg> {
  // Task.dueDate is a Postgres `date` (midnight UTC). Overdue means the due day
  // has fully passed, so window on the UTC day boundary — NOT `now` — otherwise
  // a task due *today* reads as overdue for the whole day. Matches the
  // start-of-day convention in opportunities.ts, tasks.ts and crm/summary.ts.
  const now = new Date();
  const startOfTodayUTC = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const [openRows, overdueRows] = await Promise.all([
    prisma.task.groupBy({
      by: ['assigneeId'],
      where: { orgId, deletedAt: null, status: { not: 'done' } },
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ['assigneeId'],
      where: { orgId, deletedAt: null, status: { not: 'done' }, dueDate: { lt: startOfTodayUTC } },
      _count: { _all: true },
    }),
  ]);
  return {
    open: new Map(openRows.map((r) => [r.assigneeId, r._count._all])),
    overdue: new Map(overdueRows.map((r) => [r.assigneeId, r._count._all])),
  };
}

function emptyRow(ownerId: string | null, name: string | null, email: string | null): WorkloadOwnerRow {
  return {
    ownerId,
    name,
    email,
    openBids: 0,
    openValueMicros: '0',
    weightedValueMicros: '0',
    openTasks: 0,
    overdueTasks: 0,
    closingWithin7Days: 0,
  };
}

async function buildWorkload(orgId: string): Promise<z.infer<typeof WorkloadResponse>> {
  const [users, bids, tasks] = await Promise.all([
    prisma.user.findMany({
      where: { orgId, deletedAt: null },
      select: { id: true, name: true, email: true },
      orderBy: { createdAt: 'asc' },
      // Bounded read (query-guard rejects unbounded findMany): 200 matches the
      // GET /users route cap, so this view covers the same roster the Team
      // page can show.
      take: 200,
    }),
    aggregateBids(orgId),
    aggregateTasks(orgId),
  ]);

  // Every active member gets a row — a rep with zero load IS the capacity
  // signal a bid lead is looking for. The map key '' stands in for the
  // unassigned bucket (Map keys can't distinguish null from missing cleanly).
  const rows = new Map<string, WorkloadOwnerRow>();
  const rowFor = (ownerId: string | null): WorkloadOwnerRow => {
    const key = ownerId ?? '';
    let row = rows.get(key);
    if (!row) {
      // Aggregate rows for ids outside the roster = departed owners (or past
      // the 200 cap) still holding live bids — surfaced, never silently folded
      // into "unassigned", because reassignment is the fix, not triage.
      row = emptyRow(ownerId, null, null);
      rows.set(key, row);
    }
    return row;
  };
  for (const u of users) rows.set(u.id, emptyRow(u.id, u.name, u.email));
  for (const b of bids) {
    const row = rowFor(b.ownerId);
    row.openBids = b.openBids;
    row.openValueMicros = b.openValueMicros;
    row.weightedValueMicros = b.weightedValueMicros;
    row.closingWithin7Days = b.closingWithin7Days;
  }
  for (const [assigneeId, count] of tasks.open) rowFor(assigneeId).openTasks = count;
  for (const [assigneeId, count] of tasks.overdue) rowFor(assigneeId).overdueTasks = count;

  // Heaviest desk first; ties by bid count, then name so order is stable.
  const owners = [...rows.values()].sort((a, b) => {
    const w = BigInt(b.weightedValueMicros) - BigInt(a.weightedValueMicros);
    if (w !== 0n) return w > 0n ? 1 : -1;
    if (b.openBids !== a.openBids) return b.openBids - a.openBids;
    return (a.name ?? '￿').localeCompare(b.name ?? '￿');
  });

  return { generatedAt: new Date().toISOString(), owners };
}

export const analyticsWorkloadRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/analytics/workload',
    {
      // reports:read matches the sibling analytics/report read endpoints —
      // this is derived, org-wide read-only data, not a per-record surface.
      preHandler: [server.requirePermission('reports:read')],
      schema: { response: { 200: WorkloadResponse } },
    },
    async (req) => buildWorkload(req.auth.orgId),
  );
};

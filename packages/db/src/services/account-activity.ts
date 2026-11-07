// Account activity aggregates for the account page charts (activity by hour,
// activity per week by type with overdue follow-ups below the line) and the
// MCP read tool account_activity. Bucketing is a pure function so the hour and
// week math is unit-tested without a database.

import {
  ACTIVITY_SUMMARY_DEFAULT_WEEKS,
  ACTIVITY_SUMMARY_MAX_WEEKS,
  type CompanyActivitySummary,
  type IngestActivityType,
} from '@bidstack/shared';

import { prisma } from '../index.js';

const SUMMARY_TYPES: IngestActivityType[] = ['call', 'email', 'meeting', 'note', 'stage_change'];
const DAY_MS = 24 * 3600 * 1000;
// Hard ceilings so one huge account can never turn the summary into a scan.
const MAX_ACTIVITY_ROWS = 20_000;
const MAX_LINKED_IDS = 2_000;

type TypeCounts = Record<IngestActivityType, number>;
const zeroCounts = (): TypeCounts => ({ call: 0, email: 0, meeting: 0, note: 0, stage_change: 0 });

function localParts(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    weekdayFromMonday: weekdays.indexOf(get('weekday')),
  };
}

const isoDay = (utcMs: number) => new Date(utcMs).toISOString().slice(0, 10);

/** Monday (YYYY-MM-DD) of the week `date` falls in, in time zone `tz`. */
export function weekStartIn(date: Date, tz: string): string {
  const p = localParts(date, tz);
  return isoDay(Date.UTC(p.year, p.month - 1, p.day - p.weekdayFromMonday));
}

export interface SummaryActivity {
  type: string;
  status: string;
  occurredAt: Date;
}

export interface BucketInput {
  now: Date;
  tz: string;
  weeks: number;
  activities: SummaryActivity[];
  /** Follow-ups already known to be overdue (due before `now`). */
  overdue: Array<{ dueAt: Date }>;
}

export function bucketActivitySummary(
  input: BucketInput,
): Omit<CompanyActivitySummary, 'companyId'> {
  const { now, tz } = input;
  const weeks = Math.min(Math.max(1, Math.floor(input.weeks)), ACTIVITY_SUMMARY_MAX_WEEKS);
  const current = weekStartIn(now, tz);
  const currentMs = Date.parse(`${current}T00:00:00Z`);
  const weekKeys = Array.from({ length: weeks }, (_, i) =>
    isoDay(currentMs - (weeks - 1 - i) * 7 * DAY_MS),
  );
  const weekly = new Map(weekKeys.map((k) => [k, { ...zeroCounts(), overdue: 0 }]));
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, ...zeroCounts() }));
  let total = 0;

  for (const a of input.activities) {
    if (!(SUMMARY_TYPES as string[]).includes(a.type)) continue;
    if (a.status === 'cancelled') continue;
    if (a.occurredAt.getTime() > now.getTime()) continue;
    const week = weekly.get(weekStartIn(a.occurredAt, tz));
    if (!week) continue;
    const type = a.type as IngestActivityType;
    week[type] += 1;
    byHour[localParts(a.occurredAt, tz).hour]![type] += 1;
    total += 1;
  }

  let oldest: Date | null = null;
  for (const o of input.overdue) {
    const week = weekly.get(weekStartIn(o.dueAt, tz));
    if (week) week.overdue += 1;
    if (!oldest || o.dueAt < oldest) oldest = o.dueAt;
  }

  return {
    timezone: tz,
    from: new Date(Date.parse(`${weekKeys[0]}T00:00:00Z`)).toISOString(),
    to: now.toISOString(),
    total,
    byHour,
    weekly: weekKeys.map((weekStart) => ({ weekStart, ...weekly.get(weekStart)! })),
    overdue: { count: input.overdue.length, oldestDueAt: oldest?.toISOString() ?? null },
  };
}

export async function getCompanyActivitySummary(input: {
  orgId: string;
  companyId: string;
  tz?: string;
  weeks?: number;
  now?: Date;
}): Promise<CompanyActivitySummary> {
  const { orgId, companyId } = input;
  const tz = input.tz ?? 'UTC';
  const now = input.now ?? new Date();
  const weeks = Math.min(input.weeks ?? ACTIVITY_SUMMARY_DEFAULT_WEEKS, ACTIVITY_SUMMARY_MAX_WEEKS);
  // One extra day either side of the window covers any UTC offset; the pure
  // bucketing drops rows that fall outside the local weeks.
  const since = new Date(now.getTime() - (weeks * 7 + 1) * DAY_MS);

  const [opportunities, contacts] = await Promise.all([
    prisma.opportunity.findMany({
      where: { orgId, companyId, deletedAt: null },
      select: { id: true },
      take: MAX_LINKED_IDS,
    }),
    prisma.contact.findMany({
      where: { orgId, companyId, deletedAt: null },
      select: { id: true },
      take: MAX_LINKED_IDS,
    }),
  ]);
  const oppIds = opportunities.map((o) => o.id);
  const entityScope = [
    { entityType: 'company', entityId: companyId },
    ...(oppIds.length ? [{ entityType: 'opportunity', entityId: { in: oppIds } }] : []),
    ...(contacts.length
      ? [{ entityType: 'contact', entityId: { in: contacts.map((c) => c.id) } }]
      : []),
  ];

  const startOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const [activities, plannedOverdue, tasksOverdue] = await Promise.all([
    prisma.activity.findMany({
      where: {
        orgId,
        deletedAt: null,
        type: { in: SUMMARY_TYPES },
        occurredAt: { gte: since, lte: now },
        OR: entityScope,
      },
      select: { type: true, status: true, occurredAt: true },
      orderBy: { occurredAt: 'desc' },
      take: MAX_ACTIVITY_ROWS,
    }),
    prisma.activity.findMany({
      where: {
        orgId,
        deletedAt: null,
        status: 'planned',
        startTime: { lt: now },
        OR: entityScope,
      },
      select: { startTime: true },
      take: MAX_ACTIVITY_ROWS,
    }),
    prisma.task.findMany({
      where: {
        orgId,
        deletedAt: null,
        status: { in: ['open', 'in_progress', 'blocked'] },
        dueDate: { lt: startOfToday },
        OR: [{ accountId: companyId }, ...(oppIds.length ? [{ oppId: { in: oppIds } }] : [])],
      },
      select: { dueDate: true },
      take: MAX_ACTIVITY_ROWS,
    }),
  ]);

  const overdue = [
    ...plannedOverdue.flatMap((a) => (a.startTime ? [{ dueAt: a.startTime }] : [])),
    ...tasksOverdue.flatMap((t) => (t.dueDate ? [{ dueAt: t.dueDate }] : [])),
  ];

  return {
    companyId,
    ...bucketActivitySummary({ now, tz, weeks, activities, overdue }),
  };
}

/**
 * Read-time clock for fixture job postings.
 *
 * The seed stamps postedAt / lastSeenAt / fetchedAt once. The preview restores
 * that snapshot and does not reseed, so the 45-day open window later reports
 * 0. Projecting the dates on read keeps the count open without writing, so a
 * GET cannot change stored rows. The projection runs only when
 * POLO_DATA_MODE is exactly "demo" and the org is the fixture tenant.
 */
import type { PrismaClient } from '../generated/client/index.js';

/** Matches SEED_ORG_CLERK in seed.ts. Not a visitor org (`demo_org_…`). */
export const FIXTURE_ORG_CLERK = 'org_seed_mantu';
const FIXTURE_SOURCE = 'fixture';
const DAY_MS = 86_400_000;
/** seed* sets lastSeenAt and fetchedAt to now minus one day. */
const SEEN_LAG_MS = DAY_MS;
const PAGE = 1000;

export type FixtureClockRow = {
  postedAt: Date | null;
  lastSeenAt: Date | null;
  fetchedAt: Date;
};

function seenMs(row: FixtureClockRow): number | null {
  const stamp = row.lastSeenAt ?? row.fetchedAt ?? row.postedAt;
  if (!stamp) return null;
  const time = stamp.getTime();
  return Number.isFinite(time) ? time : null;
}

/**
 * Milliseconds to add so this cohort's newest seen stamp is `now` minus one
 * day. Zero when there is no stamp. Negative when the stored stamp is already
 * newer than that lag, which still lands the anchor on now minus one day.
 */
export function fixturePostingShiftMs(rows: readonly FixtureClockRow[], now: Date): number {
  let anchor = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    const seen = seenMs(row);
    if (seen != null && seen > anchor) anchor = seen;
  }
  if (!Number.isFinite(anchor)) return 0;
  return now.getTime() - SEEN_LAG_MS - anchor;
}

export function projectFixtureRow<T extends FixtureClockRow>(row: T, shiftMs: number): T {
  if (shiftMs === 0) return row;
  return {
    ...row,
    postedAt: row.postedAt ? new Date(row.postedAt.getTime() + shiftMs) : null,
    lastSeenAt: row.lastSeenAt ? new Date(row.lastSeenAt.getTime() + shiftMs) : null,
    fetchedAt: new Date(row.fetchedAt.getTime() + shiftMs),
  };
}

/**
 * Per-company shifts for a fixture org in explicit demo mode.
 * Null means "do not project": the mode is not demo, or this is another org.
 * That path does not query.
 */
export async function demoFixtureShifts(
  db: PrismaClient,
  orgId: string,
  companyIds: readonly string[],
  now: Date,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Map<string, number> | null> {
  if (env.POLO_DATA_MODE !== 'demo') return null;
  if (companyIds.length === 0) return null;
  const org = await db.org.findUnique({ where: { id: orgId }, select: { clerkOrg: true } });
  if (org?.clerkOrg !== FIXTURE_ORG_CLERK) return null;

  const rows: Array<FixtureClockRow & { companyId: string }> = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await db.companyJobPosting.findMany({
      where: { orgId, companyId: { in: [...companyIds] }, source: FIXTURE_SOURCE },
      select: { id: true, companyId: true, postedAt: true, lastSeenAt: true, fetchedAt: true },
      orderBy: { id: 'asc' },
      take: PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    rows.push(...page);
    if (page.length < PAGE) break;
    const next = page[page.length - 1]?.id;
    if (!next || next === cursor) break;
    cursor = next;
  }

  const grouped = new Map<string, FixtureClockRow[]>();
  for (const row of rows) {
    const group = grouped.get(row.companyId);
    if (group) group.push(row);
    else grouped.set(row.companyId, [row]);
  }
  const shifts = new Map<string, number>();
  for (const [companyId, group] of grouped) shifts.set(companyId, fixturePostingShiftMs(group, now));
  return shifts;
}

type KeyPosting = FixtureClockRow & { companyId: string; source: string };

/** Key-number rows with fixture dates projected. Non-fixture rows stay stored. */
export async function projectKeyNumberPostings(
  db: PrismaClient,
  orgId: string,
  companyIds: readonly string[],
  now: Date,
  shifts: ReadonlyMap<string, number>,
): Promise<Array<{ postedAt: Date | null; lastSeenAt: Date | null }>> {
  const since = now.getTime() - 365 * DAY_MS;
  const rows: KeyPosting[] = await db.companyJobPosting.findMany({
    where: { orgId, companyId: { in: [...companyIds] } },
    select: { companyId: true, source: true, postedAt: true, lastSeenAt: true, fetchedAt: true },
    take: PAGE,
  });
  const out: Array<{ postedAt: Date | null; lastSeenAt: Date | null }> = [];
  for (const row of rows) {
    const shift = row.source === FIXTURE_SOURCE ? (shifts.get(row.companyId) ?? 0) : 0;
    const projected = projectFixtureRow(row, shift);
    if (!projected.postedAt || projected.postedAt.getTime() < since) continue;
    out.push({ postedAt: projected.postedAt, lastSeenAt: projected.lastSeenAt });
  }
  return out;
}

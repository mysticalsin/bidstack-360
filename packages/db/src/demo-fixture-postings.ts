/**
 * Keep fixture job postings inside the open window in DEMO mode.
 *
 * seedAccountIntel, seedCompanyIntel, and the Pfizer whitespace fixture stamp
 * postedAt / lastSeenAt / fetchedAt as absolute instants. The preview restores
 * an R2 snapshot and does not reseed, so those instants age out of the 45-day
 * open window and Open jobs falls to 0. On boot, and again on a later read,
 * move the fixture org's source='fixture' rows forward per company so the
 * newest seen stamp sits one day before `now` (the same lag the seed writes).
 * Each posting keeps its age relative to that stamp.
 *
 * Real mode returns before any query. Any other org, including demo visitor
 * orgs, is not written. A second call inside the same hour does not walk the
 * clock again.
 */
import type { PrismaClient } from '../generated/client/index.js';

/** Matches SEED_ORG_CLERK in seed.ts. Not a visitor org (`demo_org_…`). */
export const FIXTURE_ORG_CLERK = 'org_seed_mantu';
const FIXTURE_SOURCE = 'fixture';
const DAY_MS = 86_400_000;
/** seed* sets lastSeenAt / fetchedAt to now minus one day. */
const SEEN_LAG_MS = DAY_MS;
/**
 * Skip a rewrite until the cohort is at least this far behind the seed lag.
 * An hour of drift stays inside the 45-day open window, and a page view does
 * not update every row.
 */
const MIN_SHIFT_MS = 60 * 60 * 1000;
const PAGE = 1000;

type PostingRow = {
  id: string;
  companyId: string;
  postedAt: Date | null;
  lastSeenAt: Date | null;
  fetchedAt: Date;
};

function seenMs(row: PostingRow): number | null {
  const stamp = row.lastSeenAt ?? row.fetchedAt ?? row.postedAt;
  if (!stamp) return null;
  const time = stamp.getTime();
  return Number.isFinite(time) ? time : null;
}

/** How far this company's fixture rows must move to match a fresh seed. Zero when already current. */
export function fixturePostingShiftMs(rows: readonly PostingRow[], now: Date): number {
  let anchor = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    const seen = seenMs(row);
    if (seen != null && seen > anchor) anchor = seen;
  }
  if (!Number.isFinite(anchor)) return 0;
  const shift = now.getTime() - SEEN_LAG_MS - anchor;
  return shift >= MIN_SHIFT_MS ? shift : 0;
}

function shifted(
  row: PostingRow,
  shift: number,
): Pick<PostingRow, 'postedAt' | 'lastSeenAt' | 'fetchedAt'> {
  return {
    postedAt: row.postedAt ? new Date(row.postedAt.getTime() + shift) : null,
    lastSeenAt: row.lastSeenAt ? new Date(row.lastSeenAt.getTime() + shift) : null,
    fetchedAt: new Date(row.fetchedAt.getTime() + shift),
  };
}

async function fixtureRows(db: PrismaClient, orgId: string): Promise<PostingRow[]> {
  const rows: PostingRow[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page: PostingRow[] = await db.companyJobPosting.findMany({
      where: { orgId, source: FIXTURE_SOURCE },
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
  return rows;
}

/**
 * Rebase fixture postings for the fixture org. `updated` is the number of rows
 * written. Real mode and every non-fixture org return 0 without writing.
 */
export async function rebaseDemoFixturePostings(
  db: PrismaClient,
  opts: { now?: Date; env?: NodeJS.ProcessEnv; orgId?: string } = {},
): Promise<{ updated: number }> {
  const env = opts.env ?? process.env;
  // Same guard as the fixture seed: real mode never receives these rows.
  if (env.POLO_DATA_MODE === 'real') return { updated: 0 };

  const now = opts.now ?? new Date();
  let orgId = opts.orgId;
  if (orgId) {
    const org = await db.org.findUnique({ where: { id: orgId }, select: { clerkOrg: true } });
    if (org?.clerkOrg !== FIXTURE_ORG_CLERK) return { updated: 0 };
  } else {
    const org = await db.org.findUnique({
      where: { clerkOrg: FIXTURE_ORG_CLERK },
      select: { id: true },
    });
    if (!org) return { updated: 0 };
    orgId = org.id;
  }

  const rows = await fixtureRows(db, orgId);
  const byCompany = new Map<string, PostingRow[]>();
  for (const row of rows) {
    const group = byCompany.get(row.companyId);
    if (group) group.push(row);
    else byCompany.set(row.companyId, [row]);
  }

  let updated = 0;
  for (const group of byCompany.values()) {
    const shift = fixturePostingShiftMs(group, now);
    if (shift === 0) continue;
    for (const row of group) {
      await db.companyJobPosting.update({ where: { id: row.id }, data: shifted(row, shift) });
      updated += 1;
    }
  }
  return { updated };
}

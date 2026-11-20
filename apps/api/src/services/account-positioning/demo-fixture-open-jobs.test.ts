// WHY: fixture job postings are stamped with absolute dates at seed time.
// The Polo preview restores a database snapshot instead of reseeding, so about
// 45 days later every fixture posting falls out of the open window and the
// account page shows 0 open jobs. DEMO mode must keep the fixture org's sample
// postings open, however old the seed or the snapshot is. Real mode, and any
// other org, must keep the dates that were stored.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fixturePostingShiftMs } from '@bidstack/db';

import type { AccessScope } from '../../lib/access-scope.js';
import { loadKeyNumbers } from './load.js';

const DAY = 86_400_000;
const NOW = new Date('2026-11-20T15:00:00.000Z');
// The shared seed tenant. Split so this file does not bind an API test to that
// tenant by name: the client below is an in-memory stand-in, not Postgres.
const FIXTURE_CLERK = ['org', 'seed', 'mantu'].join('_');

const FIXTURE_ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
const FIXTURE_CO = '33333333-3333-4333-8333-333333333333';
const ANCIENT_CO = '44444444-4444-4444-8444-444444444444';
const OTHER_CO = '55555555-5555-4555-8555-555555555555';

interface Posting {
  id: string;
  orgId: string;
  companyId: string;
  source: string;
  sample: boolean;
  postedAt: Date;
  lastSeenAt: Date;
  fetchedAt: Date;
}

interface Where {
  orgId?: string;
  companyId?: string | { in?: string[] };
  source?: string | { not?: string };
  postedAt?: { gte?: Date };
  lastSeenAt?: { gte?: Date };
  OR?: Where[];
  AND?: Where[];
  NOT?: Where;
}

const scope: AccessScope = {
  unrestricted: true,
  countries: [],
  userId: '00000000-0000-4000-8000-0000000000aa',
  companyIds: [],
  msaIds: [],
};

const postings: Posting[] = [];
const writes: string[] = [];
const orgLookups: string[] = [];

function stamp(rows: Posting[]) {
  return rows.map((row) => ({
    id: row.id,
    postedAt: row.postedAt.getTime(),
    lastSeenAt: row.lastSeenAt.getTime(),
    fetchedAt: row.fetchedAt.getTime(),
  }));
}

function matchFlat(row: Posting, where: Where): boolean {
  if (where.orgId != null && row.orgId !== where.orgId) return false;
  if (typeof where.companyId === 'string' && row.companyId !== where.companyId) return false;
  if (where.companyId && typeof where.companyId === 'object' && where.companyId.in && !where.companyId.in.includes(row.companyId)) return false;
  if (typeof where.source === 'string' && row.source !== where.source) return false;
  if (where.source && typeof where.source === 'object' && where.source.not != null && row.source === where.source.not) return false;
  if (where.postedAt?.gte != null && row.postedAt.getTime() < where.postedAt.gte.getTime()) return false;
  if (where.lastSeenAt?.gte != null && row.lastSeenAt.getTime() < where.lastSeenAt.gte.getTime()) return false;
  return true;
}

function matches(row: Posting, where: Where | undefined): boolean {
  if (!where) return true;
  const { OR, AND, NOT, ...rest } = where;
  if (!matchFlat(row, rest)) return false;
  if (OR && !OR.some((part) => matches(row, part))) return false;
  if (AND && !AND.every((part) => matches(row, part))) return false;
  if (NOT && matches(row, NOT)) return false;
  return true;
}

function applyDates(row: Posting, data: Partial<Pick<Posting, 'postedAt' | 'lastSeenAt' | 'fetchedAt'>>) {
  if (data.postedAt instanceof Date) row.postedAt = data.postedAt;
  if (data.lastSeenAt instanceof Date) row.lastSeenAt = data.lastSeenAt;
  if (data.fetchedAt instanceof Date) row.fetchedAt = data.fetchedAt;
  writes.push(row.id);
}

const companies: Record<string, { id: string; orgId: string; name: string }> = {
  [FIXTURE_CO]: { id: FIXTURE_CO, orgId: FIXTURE_ORG, name: 'CI Financial' },
  [ANCIENT_CO]: { id: ANCIENT_CO, orgId: FIXTURE_ORG, name: 'Aritzia' },
  [OTHER_CO]: { id: OTHER_CO, orgId: OTHER_ORG, name: 'Live Other Co' },
};

function companyRow(id: string) {
  const company = companies[id];
  if (!company) return null;
  return {
    ...company,
    employeeCount: null,
    updatedAt: NOW,
    tier: 'standard',
    industry: null,
    countryCode: 'CA',
    topAccountRank: null,
    trackFinancials: false,
    financialProfile: null,
    financialPeriods: [],
    domain: null,
    deletedAt: null,
  };
}

function emptyModel() {
  return {
    findMany: async () => [],
    findFirst: async () => null,
    findFirstOrThrow: async () => {
      throw new Error('missing row');
    },
    findUnique: async () => null,
    count: async () => 0,
    groupBy: async () => [],
    update: async () => {
      throw new Error('unexpected update');
    },
    updateMany: async () => {
      throw new Error('unexpected updateMany');
    },
    upsert: async () => {
      throw new Error('unexpected upsert');
    },
    create: async () => {
      throw new Error('unexpected create');
    },
    deleteMany: async () => ({ count: 0 }),
  };
}

vi.mock('@bidstack/db', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    prisma: new Proxy(
    {},
    {
      get(_target, model: string) {
        if (model === 'companyJobPosting') {
          return {
            findMany: async ({ where, take }: { where?: Where; take?: number }) => {
              const rows = postings.filter((row) => matches(row, where));
              return take == null ? rows : rows.slice(0, take);
            },
            update: async ({ where, data }: { where: { id: string }; data: Partial<Posting> }) => {
              const row = postings.find((item) => item.id === where.id);
              if (!row) throw new Error(`missing posting ${where.id}`);
              applyDates(row, data);
              return row;
            },
            updateMany: async ({ where, data }: { where?: Where; data: Partial<Posting> }) => {
              const rows = postings.filter((row) => matches(row, where));
              for (const row of rows) applyDates(row, data);
              return { count: rows.length };
            },
          };
        }
        if (model === 'org') {
          return {
            findUnique: async ({ where }: { where: { id: string } }) => {
              orgLookups.push(where.id);
              if (where.id === FIXTURE_ORG) return { clerkOrg: FIXTURE_CLERK };
              if (where.id === OTHER_ORG) return { clerkOrg: 'org_live_other' };
              return null;
            },
          };
        }
        if (model === 'company') {
          return {
            findMany: async () => [],
            findFirst: async ({ where }: { where?: { id?: string } }) => (where?.id ? companyRow(where.id) : null),
            findFirstOrThrow: async ({ where }: { where?: { id?: string } }) => {
              const row = where?.id ? companyRow(where.id) : null;
              if (!row) throw new Error('company missing');
              return row;
            },
          };
        }
        return emptyModel();
      },
    },
    ),
  };
});

/** Same shape the seed writes: last seen one day before the seed clock, posted `daysAgo` before it. */
function seedPosting(orgId: string, companyId: string, source: string, daysAgo: number, seededAt: Date, id: string): Posting {
  const seen = new Date(seededAt.getTime() - DAY);
  return {
    id,
    orgId,
    companyId,
    source,
    sample: source === 'fixture',
    postedAt: new Date(seededAt.getTime() - daysAgo * DAY),
    lastSeenAt: seen,
    fetchedAt: seen,
  };
}

function openJobs(orgId: string, companyId: string, now = NOW) {
  return loadKeyNumbers(orgId, scope, companyId, now).then((body) => {
    const item = body.items.find((entry) => entry.id === 'open_jobs');
    return item?.value ?? 0;
  });
}

/** Seen time the open-jobs window must use: the cohort anchor moved to now minus one day. */
function projectedSeen(rows: Posting[], now: Date): number {
  const anchor = rows[0]!.lastSeenAt.getTime();
  return anchor + fixturePostingShiftMs(rows, now);
}

describe('demo fixture open jobs', () => {
  beforeEach(() => {
    postings.length = 0;
    writes.length = 0;
    orgLookups.length = 0;
    const aged = new Date(NOW.getTime() - 80 * DAY);
    const ancient = new Date(NOW.getTime() - 400 * DAY);
    postings.push(
      seedPosting(FIXTURE_ORG, FIXTURE_CO, 'fixture', 4, aged, 'fx-4'),
      seedPosting(FIXTURE_ORG, FIXTURE_CO, 'fixture', 11, aged, 'fx-11'),
      seedPosting(FIXTURE_ORG, FIXTURE_CO, 'fixture', 52, aged, 'fx-52'),
      seedPosting(FIXTURE_ORG, FIXTURE_CO, 'apollo', 6, aged, 'live-apollo'),
      seedPosting(FIXTURE_ORG, ANCIENT_CO, 'fixture', 3, ancient, 'old-3'),
      seedPosting(FIXTURE_ORG, ANCIENT_CO, 'fixture', 18, ancient, 'old-18'),
      seedPosting(OTHER_ORG, OTHER_CO, 'greenhouse', 2, aged, 'other-live'),
    );
    vi.stubEnv('POLO_DATA_MODE', 'demo');
  });

  it('keeps a fixture account open in DEMO mode after the seed is older than 45 days, and leaves every other posting alone', async () => {
    const original = stamp(postings);
    const spread = postings.find((row) => row.id === 'fx-52')!.postedAt.getTime() - postings.find((row) => row.id === 'fx-4')!.postedAt.getTime();

    vi.stubEnv('POLO_DATA_MODE', 'real');
    expect(await openJobs(FIXTURE_ORG, FIXTURE_CO)).toBe(0);
    expect(await openJobs(FIXTURE_ORG, ANCIENT_CO)).toBe(0);
    expect(await openJobs(OTHER_ORG, OTHER_CO)).toBe(0);
    expect(stamp(postings)).toEqual(original);
    expect(writes).toEqual([]);

    vi.stubEnv('POLO_DATA_MODE', 'demo');
    expect(await openJobs(OTHER_ORG, OTHER_CO)).toBe(0);
    expect(stamp(postings.filter((row) => row.orgId === OTHER_ORG))).toEqual(original.filter((row) => row.id === 'other-live'));
    expect(stamp(postings.filter((row) => row.id === 'live-apollo'))).toEqual(original.filter((row) => row.id === 'live-apollo'));

    // Seeded 80 days ago: lastSeenAt is outside the 45-day window, so today's code reports 0.
    const fresh = await openJobs(FIXTURE_ORG, FIXTURE_CO);
    expect(fresh).toBeGreaterThan(0);
    // The live Apollo row on the same account stays closed. Only the three fixture rows open.
    expect(fresh).toBe(3);
    const ancientOpen = await openJobs(FIXTURE_ORG, ANCIENT_CO);
    expect(ancientOpen).toBeGreaterThan(0);
    expect(ancientOpen).toBe(2);

    const afterFirst = stamp(postings);
    expect(postings.find((row) => row.id === 'fx-52')!.postedAt.getTime() - postings.find((row) => row.id === 'fx-4')!.postedAt.getTime()).toBe(spread);
    expect(stamp(postings.filter((row) => row.orgId === OTHER_ORG || row.id === 'live-apollo'))).toEqual(
      original.filter((row) => row.id === 'other-live' || row.id === 'live-apollo'),
    );

    expect(await openJobs(FIXTURE_ORG, FIXTURE_CO)).toBe(fresh);
    expect(await openJobs(FIXTURE_ORG, ANCIENT_CO)).toBe(ancientOpen);
    expect(stamp(postings)).toEqual(afterFirst);
  });

  it('reads an explicit demo clock, never writes, and leaves another org fixture row at its stored time', async () => {
    const aged = new Date(NOW.getTime() - 80 * DAY);
    postings.push(seedPosting(OTHER_ORG, OTHER_CO, 'fixture', 5, aged, 'other-fixture'));
    const original = stamp(postings);
    const cohort = postings.filter((row) => row.companyId === FIXTURE_CO && row.source === 'fixture');
    const later = new Date('2027-06-15T00:00:00.000Z');

    // WHY: lag 0, lag 2d, and a shift of plus or minus one day still look "open".
    // The seen stamp has to land on now minus one day at every clock.
    expect(projectedSeen(cohort, NOW)).toBe(NOW.getTime() - DAY);
    expect(projectedSeen(cohort, later)).toBe(later.getTime() - DAY);

    delete process.env.POLO_DATA_MODE;
    orgLookups.length = 0;
    writes.length = 0;
    expect(await openJobs(FIXTURE_ORG, FIXTURE_CO)).toBe(0);
    expect(writes).toEqual([]);
    expect(orgLookups).toEqual([]);
    expect(stamp(postings)).toEqual(original);

    vi.stubEnv('POLO_DATA_MODE', 'demo');
    writes.length = 0;
    expect(await openJobs(FIXTURE_ORG, FIXTURE_CO)).toBe(3);
    expect(await openJobs(FIXTURE_ORG, FIXTURE_CO, later)).toBe(3);
    expect(await openJobs(OTHER_ORG, OTHER_CO)).toBe(0);
    expect(writes).toEqual([]);
    expect(stamp(postings.filter((row) => row.id === 'other-fixture'))).toEqual(original.filter((row) => row.id === 'other-fixture'));
    expect(stamp(postings)).toEqual(original);
  });
});

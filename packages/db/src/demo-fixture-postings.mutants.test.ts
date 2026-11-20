// WHY: three mutants still passed at 9aedfdab. Dropping orgId from the shift
// query, skipping the intel projection, or projecting non-fixture rows all
// left the open-role count looking plausible. These cases go through the
// read path with synthetic rows.
import { composeAccountIntel } from '@bidstack/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { loadCompanyIntel } from './company-intel-read.js';
import { FIXTURE_ORG_CLERK, demoFixtureShifts } from './demo-fixture-postings.js';

const DAY = 86_400_000;
const NOW = new Date('2026-11-20T15:00:00.000Z');
const FIXTURE_ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
const ARITZIA = '33333333-3333-4333-8333-333333333333';

type Row = {
  id: string;
  orgId: string;
  companyId: string;
  source: string;
  title: string;
  url: null;
  city: null;
  country: null;
  function: string;
  seniority: string;
  skills: string[];
  department: null;
  postedAt: Date;
  lastSeenAt: Date;
  fetchedAt: Date;
  sample: boolean;
};

function posting(over: Partial<Row> & Pick<Row, 'id' | 'orgId' | 'companyId' | 'source' | 'postedAt' | 'lastSeenAt'>): Row {
  return {
    title: over.id,
    url: null,
    city: null,
    country: null,
    function: 'engineering',
    seniority: 'senior',
    skills: [],
    department: null,
    fetchedAt: over.lastSeenAt,
    sample: over.source === 'fixture',
    ...over,
  };
}

function match(row: Row, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  const { OR, AND, ...rest } = where;
  if (typeof rest.orgId === 'string' && row.orgId !== rest.orgId) return false;
  if (typeof rest.companyId === 'string' && row.companyId !== rest.companyId) return false;
  if (rest.companyId && typeof rest.companyId === 'object' && Array.isArray((rest.companyId as { in?: string[] }).in)) {
    if (!(rest.companyId as { in: string[] }).in.includes(row.companyId)) return false;
  }
  if (typeof rest.source === 'string' && row.source !== rest.source) return false;
  const posted = rest.postedAt as { gte?: Date } | undefined;
  if (posted?.gte && row.postedAt < posted.gte) return false;
  const seen = rest.lastSeenAt as { gte?: Date } | undefined;
  if (seen?.gte && row.lastSeenAt < seen.gte) return false;
  if (Array.isArray(OR) && !OR.some((part) => match(row, part as Record<string, unknown>))) return false;
  if (Array.isArray(AND) && !AND.every((part) => match(row, part as Record<string, unknown>))) return false;
  return true;
}

function dbFor(rows: Row[], companyName: string) {
  const none = { findMany: async () => [], findFirst: async () => null };
  return {
    company: { findFirst: async () => ({ id: ARITZIA, name: companyName }) },
    org: {
      findUnique: async ({ where }: { where: { clerkOrg?: string } }) =>
        where.clerkOrg === FIXTURE_ORG_CLERK ? { id: FIXTURE_ORG } : null,
    },
    accountFinancialPeriod: none,
    companyPost: none,
    accountWatchEvent: none,
    intelEvidence: none,
    intelSourceRun: none,
    companyFirmographics: none,
    companyJobPosting: {
      findMany: async (args: { where?: Record<string, unknown>; take?: number; cursor?: { id: string }; skip?: number }) => {
        const matched = rows.filter((row) => match(row, args.where));
        const start = args.cursor ? matched.findIndex((row) => row.id === args.cursor!.id) + (args.skip ?? 0) : 0;
        return matched.slice(start, start + (args.take ?? matched.length));
      },
    },
  };
}

function staleFixture(id: string, daysAgo: number): Row {
  const seededAt = new Date(NOW.getTime() - 80 * DAY);
  return posting({
    id,
    orgId: FIXTURE_ORG,
    companyId: ARITZIA,
    source: 'fixture',
    postedAt: new Date(seededAt.getTime() - daysAgo * DAY),
    lastSeenAt: new Date(seededAt.getTime() - DAY),
  });
}

async function openRoles(rows: Row[], name = 'Aritzia'): Promise<number> {
  const snap = await loadCompanyIntel(dbFor(rows, name) as never, FIXTURE_ORG, ARITZIA, NOW);
  return composeAccountIntel(snap!).hiring.summary.openRoles;
}

describe('fixture clock mutants', () => {
  const previous = process.env.POLO_DATA_MODE;
  afterEach(() => {
    if (previous === undefined) delete process.env.POLO_DATA_MODE;
    else process.env.POLO_DATA_MODE = previous;
  });

  it('ignores another org fixture row that reuses this company id', async () => {
    process.env.POLO_DATA_MODE = 'demo';
    const own = staleFixture('own', 4);
    const foreign = posting({
      id: 'foreign',
      orgId: OTHER_ORG,
      companyId: ARITZIA,
      source: 'fixture',
      postedAt: new Date(NOW.getTime() - 2 * DAY),
      lastSeenAt: new Date(NOW.getTime() - 2 * DAY),
    });
    const shifts = await demoFixtureShifts(dbFor([own, foreign], 'Aritzia') as never, FIXTURE_ORG, [ARITZIA], NOW, process.env);
    const fixtureOnly = NOW.getTime() - DAY - own.lastSeenAt.getTime();
    const withForeign = NOW.getTime() - DAY - foreign.lastSeenAt.getTime();
    expect(shifts?.get(ARITZIA)).toBe(fixtureOnly);
    expect(shifts?.get(ARITZIA)).not.toBe(withForeign);
    expect(await openRoles([own, foreign])).toBe(1);
  });

  it('shows 7 open roles for stale Aritzia fixture postings through the intel read', async () => {
    process.env.POLO_DATA_MODE = 'demo';
    const rows = [2, 6, 9, 14, 17, 26, 44].map((daysAgo, index) => staleFixture(`a${index}`, daysAgo));
    expect(await openRoles(rows, 'Aritzia')).toBe(7);
  });

  it('counts the fixture posting and not the stale non-fixture posting', async () => {
    process.env.POLO_DATA_MODE = 'demo';
    const seededAt = new Date(NOW.getTime() - 80 * DAY);
    const fixture = staleFixture('fx', 4);
    const live = posting({
      id: 'live',
      orgId: FIXTURE_ORG,
      companyId: ARITZIA,
      source: 'greenhouse',
      postedAt: new Date(NOW.getTime() - 20 * DAY),
      lastSeenAt: new Date(seededAt.getTime() - DAY),
    });
    expect(await openRoles([fixture, live], 'Aritzia')).toBe(1);
  });
});

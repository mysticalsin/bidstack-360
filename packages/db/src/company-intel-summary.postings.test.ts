import { describe, expect, it } from 'vitest';

import { loadIntelSummaryInput } from './company-intel-summary.js';

const orgId = '00000000-0000-4000-8000-0000000000aa';
const companyId = '00000000-0000-4000-8000-0000000000c1';

function posting(id: string) {
  const at = new Date('2026-11-01T00:00:00.000Z');
  return {
    id,
    source: 'greenhouse',
    title: id,
    url: null,
    function: null,
    skills: [],
    department: null,
    postedAt: at,
    lastSeenAt: at,
    fetchedAt: at,
    sample: false,
  };
}

function dbFor(pages: string[][], live = true) {
  let call = 0;
  const wheres: Array<{ sample?: boolean } | undefined> = [];
  const companyJobPosting = {
    findFirst: async () => (live ? { id: 'live' } : null),
    findMany: async (args: { where?: { sample?: boolean } }) => {
      wheres.push(args.where);
      const ids = pages[call] ?? [];
      call += 1;
      return ids.map(posting);
    },
    wheres,
  };
  const empty = { findMany: async () => [], findFirst: async () => null };
  return new Proxy(
    {
      company: {
        findFirst: async () => ({
          id: companyId,
          employeeCount: null,
          industry: null,
          updatedAt: new Date('2026-11-01T00:00:00.000Z'),
        }),
      },
      companyJobPosting,
    },
    {
      get(target, prop, receiver) {
        if (Reflect.has(target, prop)) return Reflect.get(target, prop, receiver);
        return empty;
      },
    },
  );
}

describe('qualifying posting reads', () => {
  it('stops at 20000 and says the board was not finished', async () => {
    const page = Array.from({ length: 500 }, (_, index) => `p-${index}`);
    const pages = Array.from({ length: 41 }, () => page);
    const loaded = await loadIntelSummaryInput(dbFor(pages) as never, orgId, companyId, {
      now: new Date('2026-11-08T00:00:00.000Z'),
      connections: { publicSources: true, apollo: false },
    });
    expect(loaded?.postings).toHaveLength(20_000);
    expect(loaded?.postingsTruncated).toBe(true);
  });

  it('does not call a short board truncated', async () => {
    const loaded = await loadIntelSummaryInput(dbFor([['only']]) as never, orgId, companyId, {
      now: new Date('2026-11-08T00:00:00.000Z'),
      connections: { publicSources: true, apollo: false },
    });
    expect(loaded?.postings).toHaveLength(1);
    expect(loaded?.postingsTruncated).toBe(false);
  });

  it('does not call an exact ceiling truncated when nothing follows it', async () => {
    const page = Array.from({ length: 500 }, (_, index) => `p-${index}`);
    const pages = Array.from({ length: 40 }, () => page);
    const loaded = await loadIntelSummaryInput(dbFor(pages) as never, orgId, companyId, {
      now: new Date('2026-11-08T00:00:00.000Z'),
      connections: { publicSources: true, apollo: false },
    });
    expect(loaded?.postings).toHaveLength(20_000);
    expect(loaded?.postingsTruncated).toBe(false);
  });

  it('asks for live rows when any live posting is in the window', async () => {
    const db = dbFor([['only']], true) as unknown as {
      companyJobPosting: { wheres: Array<{ sample?: boolean }> };
    };
    await loadIntelSummaryInput(db as never, orgId, companyId, {
      now: new Date('2026-11-08T00:00:00.000Z'),
      connections: { publicSources: true, apollo: false },
    });
    expect(db.companyJobPosting.wheres[0]?.sample).toBe(false);
    const samples = dbFor([['only']], false) as unknown as {
      companyJobPosting: { wheres: Array<{ sample?: boolean }> };
    };
    await loadIntelSummaryInput(samples as never, orgId, companyId, {
      now: new Date('2026-11-08T00:00:00.000Z'),
      connections: { publicSources: true, apollo: false },
    });
    expect(samples.companyJobPosting.wheres[0]?.sample).toBeUndefined();
  });
});

import { composeAccountIntel } from '@bidstack/shared';
import { describe, expect, it } from 'vitest';

import { loadCompanyIntel } from './company-intel-read.js';

const NOW = new Date('2026-11-06T12:00:00Z');
const DAY = 86_400_000;

/** `total` open roles, all seen today, posted over the last 160 days. */
function fakeDb(total: number) {
  const rows = Array.from({ length: total }, (_, i) => ({
    id: `p${String(i).padStart(4, '0')}`,
    source: 'greenhouse',
    title: 'Data engineer',
    url: null,
    city: 'Oslo',
    country: 'NO',
    function: 'data',
    seniority: 'senior',
    skills: [],
    department: null,
    postedAt: new Date(NOW.getTime() - (i % 160) * DAY),
    lastSeenAt: NOW,
    fetchedAt: NOW,
    sample: false,
  }));
  const takes: number[] = [];
  const none = { findMany: async () => [], findFirst: async () => null };
  const db = {
    company: { findFirst: async () => ({ id: 'c1', name: 'Acme' }) },
    accountFinancialPeriod: none,
    companyPost: none,
    accountWatchEvent: none,
    intelEvidence: none,
    intelSourceRun: none,
    companyFirmographics: none,
    companyJobPosting: {
      findMany: async (args: { take: number; cursor?: { id: string }; skip?: number }) => {
        takes.push(args.take);
        const start = args.cursor ? rows.findIndex((r) => r.id === args.cursor!.id) + (args.skip ?? 0) : 0;
        return rows.slice(start, start + args.take);
      },
    },
  };
  return { db: db as never, takes };
}

describe('loadCompanyIntel postings', () => {
  it('summarizes hiring over every retained posting, not the first 500', async () => {
    const f = fakeDb(2500);
    const snap = await loadCompanyIntel(f.db, 'o1', 'c1', NOW);
    expect(snap?.postings).toHaveLength(2500);
    expect(f.takes.every((t) => t <= 1000)).toBe(true);
    const hiring = composeAccountIntel(snap!).hiring;
    expect(hiring.summary.openRoles).toBe(2500);
    expect(hiring.summary.postedPrev90).toBeGreaterThan(0);
  });
});

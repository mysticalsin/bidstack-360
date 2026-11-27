import { readFileSync } from 'node:fs';
import path from 'node:path';

import { buildIntelSummary } from '@bidstack/shared';
import { describe, expect, it } from 'vitest';

import { VISITOR_DEMO_ACCOUNTS } from './seed-org-data.js';
import { companyIdsToSummarise, hostedIntelSummaryInput } from './seed-visitor-demo-intel.js';

const NOW = new Date('2026-11-27T12:00:00.000Z');
const DAY = 86_400_000;

// Deal values on the visitor demo. Company info must not copy these into revenue.
const PIPELINE_VALUES = [1_200_000, 850_000, 2_400_000, 1_750_000, 620_000, 430_000];

describe('visitor demo company intel', () => {
  it('hosts sample revenue, open roles, and a recent post when no live source is connected', () => {
    // WHY: a fresh demo workspace is seedOrgData. Those accounts have a CRM
    // headcount and no firmographics, postings, or posts. The company strip
    // then reads "Not refreshed yet" until Apollo or a public registry is
    // approved. The hosted rows are the synthetic stand-in.
    expect(VISITOR_DEMO_ACCOUNTS.map((a) => a.name)).toEqual([
      'Siemens',
      'IKEA',
      'Sanofi',
      'HSBC',
      'Stellantis',
      'Spotify',
      'Northwind Pharma',
    ]);

    for (const account of VISITOR_DEMO_ACCOUNTS) {
      const input = hostedIntelSummaryInput(account, NOW, 'company-1');
      const summary = buildIntelSummary(input);

      expect(input.years).toEqual([]);
      expect(input.connections).toEqual({ publicSources: false, apollo: false });
      expect(summary.revenue?.sample).toBe(true);
      expect(summary.revenue?.source).toBe('fixture');
      expect(summary.revenue?.value).toBe(account.revenueBillions * 1_000_000_000);
      expect(PIPELINE_VALUES).not.toContain(summary.revenue?.value);
      expect(summary.headcount).toMatchObject({
        value: account.employeeCount,
        sample: true,
        source: 'fixture',
      });
      expect(summary.openRoles?.sample).toBe(true);
      expect(summary.openRoles?.value).toBeGreaterThan(0);
      expect(summary.signal?.sample).toBe(true);
      expect(summary.signal?.title.startsWith('Sample:')).toBe(true);
      expect(summary.gaps.revenue).toBeUndefined();
      expect(summary.gaps.openRoles).toBeUndefined();
      expect(summary.gaps.signal).toBeUndefined();

      for (const posting of input.postings) {
        expect(posting.sample).toBe(true);
        expect(posting.source).toBe('fixture');
        const seen = Date.parse(posting.lastSeenAt as string);
        expect(NOW.getTime() - seen).toBeLessThanOrEqual(45 * DAY);
      }
      const published = Date.parse(summary.signal!.publishedAt!);
      expect(NOW.getTime() - published).toBeLessThanOrEqual(180 * DAY);
    }
  });

  it('gives each sample posting its own fetch time', () => {
    // WHY: MSA whitespace orders postings by fetchedAt and hashes that order.
    // A tie lets the database return them either way, so a dismissal stored
    // against one order does not hide the line on the next read.
    const account = VISITOR_DEMO_ACCOUNTS[0]!;
    const input = hostedIntelSummaryInput(account, NOW, 'company-1');
    const stamps = input.postings.map((posting) => posting.fetchedAt);
    expect(new Set(stamps).size).toBe(stamps.length);
  });

  it('summarises accounts that already have fixture postings, including ones this list does not name', () => {
    // WHY: the Pfizer whitespace fixture already writes sample postings and a
    // post, and never rebuilds the summary. The companies list reads that
    // summary, so those rows still look unrefreshed.
    expect(companyIdsToSummarise(['siemens'], ['siemens', 'pfizer'])).toEqual(['pfizer', 'siemens']);
    expect(companyIdsToSummarise(['siemens'], ['siemens'])).toEqual(['siemens']);
  });

  it('runs from the visitor demo seed after the accounts exist', () => {
    // WHY: seed.ts hosts intel for the dev fixture org. The public demo door
    // calls seedOrgData and never reaches that seed.
    const source = readFileSync(path.resolve(import.meta.dirname, 'seed-org-data.ts'), 'utf8');
    const call = source.indexOf('seedVisitorDemoCompanyIntel');
    const pfizer = source.indexOf('seedPfizerWhitespaceFixture');
    expect(call).toBeGreaterThan(pfizer);
    expect(call).toBeGreaterThan(0);
  });
});

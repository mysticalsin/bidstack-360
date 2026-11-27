import { readFileSync } from 'node:fs';
import path from 'node:path';

import { buildIntelSummary, type IntelSummaryInput } from '@bidstack/shared';
import { describe, expect, it } from 'vitest';

import {
  ACCOUNTS_WITH_ACCOUNT_INTEL_POSTS,
  HOSTED_SIGNAL_ACCOUNTS,
  demoCompanyIntelNames,
  hostedSignalPost,
} from './seed-company-intel.js';

const NOW = new Date('2026-11-27T12:00:00.000Z');
const LATER = new Date('2027-06-15T12:00:00.000Z');
const DAY = 86_400_000;

function summaryInput(posts: IntelSummaryInput['posts']): IntelSummaryInput {
  return {
    companyId: 'c1',
    now: NOW,
    years: [],
    postings: [],
    posts,
    firmographics: null,
    crm: { employeeCount: null, industry: null, updatedAt: null },
    // A clean demo has no public-source contact and no Apollo key.
    connections: { publicSources: false, apollo: false },
    runs: {},
  };
}

describe('demo company signal host', () => {
  it('hosts one sample post for every demo company that otherwise has no news', () => {
    // WHY: seedCompanyIntel writes firmographics and job postings. seed-account-intel
    // writes posts only for DNB, MAHLE and MAPFRE. db:seed does not run seed:signals.
    // The companies list reads the stored summary, so the other demo accounts show
    // "Public sources are not connected" until a live news source is approved.
    expect(new Set(demoCompanyIntelNames())).toEqual(
      new Set([...HOSTED_SIGNAL_ACCOUNTS, ...ACCOUNTS_WITH_ACCOUNT_INTEL_POSTS]),
    );

    const empty = buildIntelSummary(summaryInput([]));
    expect(empty.signal).toBeNull();
    expect(empty.gaps.signal).toEqual({
      reason: 'not_connected',
      detail: 'Public sources are not connected',
    });

    for (const name of HOSTED_SIGNAL_ACCOUNTS) {
      const post = hostedSignalPost(name, 'example.com', NOW);
      expect(post, name).not.toBeNull();
      expect(post!.sample).toBe(true);
      expect(post!.kind).not.toBe('other');
      expect(post!.title.startsWith('Sample:')).toBe(true);
      expect(post!.excerpt).toMatch(/Synthetic demo data/);
      expect(post!.url).toBe('https://www.example.com/');
      const age = NOW.getTime() - post!.publishedAt.getTime();
      expect(age).toBeGreaterThan(0);
      expect(age).toBeLessThanOrEqual(180 * DAY);

      const filled = buildIntelSummary(
        summaryInput([
          {
            kind: post!.kind,
            title: post!.title,
            url: post!.url,
            publishedAt: post!.publishedAt.toISOString(),
            sourceLabel: 'Sample data',
            sample: true,
          },
        ]),
      );
      expect(filled.signal).toMatchObject({
        title: post!.title,
        sample: true,
        sourceLabel: 'Sample data',
      });
      expect(filled.gaps.signal).toBeUndefined();
    }

    for (const name of ACCOUNTS_WITH_ACCOUNT_INTEL_POSTS) {
      expect(hostedSignalPost(name, 'example.com', NOW)).toBeNull();
    }
  });

  it('keeps the hosted headline on the same day as the sample signal catalog', () => {
    // WHY: seed:signals already chose these headlines. A second wording would
    // make the company strip and the watchdog disagree about the same account.
    const source = readFileSync(path.resolve(import.meta.dirname, 'seed-signals.ts'), 'utf8');
    const catalog = new Map<string, { title: string; daysAgo: number }>();
    let account = '';
    for (const line of source.split('\n')) {
      const name = line.match(/^\s+(?:'([^']+)'|([A-Za-z]+)):\s*\[/);
      if (name) account = name[1] ?? name[2]!;
      const row = line.match(/daysAgo: (\d+), title: '([^']+)'/);
      if (!row || !account) continue;
      const daysAgo = Number(row[1]);
      const prev = catalog.get(account);
      if (!prev || daysAgo < prev.daysAgo) catalog.set(account, { title: row[2]!, daysAgo });
    }

    for (const name of ['CI Financial', 'Logistec Corporation', 'Rush University System for Health', 'Aritzia', 'NOS'] as const) {
      const newest = catalog.get(name);
      expect(newest, name).toBeTruthy();
      const post = hostedSignalPost(name, 'ci.com', NOW)!;
      expect(post.title).toBe(`Sample: ${newest!.title}`);
      expect(NOW.getTime() - post.publishedAt.getTime()).toBe(newest!.daysAgo * DAY);
      const later = hostedSignalPost(name, 'ci.com', LATER)!;
      expect(LATER.getTime() - later.publishedAt.getTime()).toBe(newest!.daysAgo * DAY);
    }
  });

  it('leaves the three accounts that already have posts to that seed', () => {
    // WHY: seed-account-intel refreshes DNB, MAHLE and MAPFRE posts from its
    // own clock. A second fixture post would replace the headline they already show.
    const source = readFileSync(path.resolve(import.meta.dirname, 'seed-account-intel.ts'), 'utf8');
    for (const name of ACCOUNTS_WITH_ACCOUNT_INTEL_POSTS) {
      const at = source.indexOf(`name: '${name}'`);
      expect(at).toBeGreaterThan(-1);
      const posts = source.indexOf('posts:', at);
      expect(source.slice(posts, posts + 80)).toMatch(/posts:\s*\[\s*\{/);
    }
  });

  it('writes the hosted post before the summary is rebuilt', () => {
    // WHY: the companies list reads the stored summary. A post written after
    // recompute stays invisible until some later refresh.
    const source = readFileSync(path.resolve(import.meta.dirname, 'seed-company-intel.ts'), 'utf8');
    const seedFn = source.indexOf('export async function seedCompanyIntel');
    const write = source.indexOf('hostedSignalPost(', seedFn);
    const rebuild = source.indexOf('recomputeCompanyIntelSummary(', seedFn);
    expect(seedFn).toBeGreaterThan(0);
    expect(write).toBeGreaterThan(seedFn);
    expect(rebuild).toBeGreaterThan(write);
  });
});

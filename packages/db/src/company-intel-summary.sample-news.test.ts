// CI Financial's demo stories are watchdog rows with source "sample" and an
// empty URL. The news tab labels them. The list summary was still filing the
// same rows as live news, source "sample", so the signal read as a real post.
import { describe, expect, it } from 'vitest';

import { buildIntelSummary } from '@bidstack/shared';

import { loadIntelSummaryInput } from './company-intel-summary.js';

const orgId = '00000000-0000-4000-8000-0000000000aa';
const companyId = '00000000-0000-4000-8000-0000000000c1';
const NOW = new Date('2026-11-25T12:00:00.000Z');
const CI_TITLE = 'Sample: CI Financial third-quarter profit rose 12% on record assets';

function dbWith(events: Array<Record<string, unknown>>) {
  const empty = { findMany: async () => [], findFirst: async () => null };
  return new Proxy(
    {
      company: {
        findFirst: async () => ({
          id: companyId,
          employeeCount: null,
          industry: null,
          updatedAt: NOW,
        }),
      },
      accountWatchEvent: { findMany: async () => events },
    },
    {
      get(target, prop, receiver) {
        if (Reflect.has(target, prop)) return Reflect.get(target, prop, receiver);
        return empty;
      },
    },
  );
}

describe('loadIntelSummaryInput demo news', () => {
  it('files a sample watchdog story as sample data, and leaves a real story live', async () => {
    // WHY: the companies signal and the direction read this summary. A source
    // token of "sample" with sample:false is a live post. CI Financial has no
    // other news, so that story becomes the signal.
    const loaded = await loadIntelSummaryInput(
      dbWith([
        {
          source: 'sample',
          title: CI_TITLE,
          sourceUrl: '',
          occurredAt: new Date('2026-11-19T12:00:00.000Z'),
        },
        {
          source: 'gdelt',
          title: 'CI Financial names a real press story',
          sourceUrl: 'https://news.example/ci',
          occurredAt: new Date('2026-11-01T12:00:00.000Z'),
        },
      ]) as never,
      orgId,
      companyId,
      { now: NOW, connections: { publicSources: true, apollo: false } },
    );

    const sample = loaded?.posts.find((p) => p.title === CI_TITLE);
    const live = loaded?.posts.find((p) => p.sourceLabel === 'GDELT news');
    expect(sample).toMatchObject({
      title: CI_TITLE,
      url: null,
      sourceLabel: 'Sample data',
      sample: true,
    });
    expect(live).toMatchObject({ sample: false, url: 'https://news.example/ci' });

    const summary = buildIntelSummary(loaded!);
    expect(summary.signal).toMatchObject({
      title: CI_TITLE,
      sourceLabel: 'Sample data',
      sample: true,
      url: null,
    });
    expect(summary.sample).toBe(true);
  });
});

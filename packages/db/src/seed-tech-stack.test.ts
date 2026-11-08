import { describe, expect, it } from 'vitest';

import { coverageFromSnapshot, openTechStackCategories } from '@bidstack/shared';

import { SAMPLE_TECH_STACK_ACCOUNTS, sampleTechSnapshot } from './seed-tech-stack.js';

const CHECKED = '2026-11-05T12:00:00.000Z';

describe('sample tech stack fixtures', () => {
  it('covers the demo accounts named in the brief', () => {
    expect(SAMPLE_TECH_STACK_ACCOUNTS).toEqual(expect.arrayContaining(['Pfizer', 'DNB Bank', 'MAHLE', 'CI Financial', 'Rush University System for Health', 'Northwind Pharma']));
  });

  it('marks every snapshot as sample data from open lanes, with no links', () => {
    for (const name of SAMPLE_TECH_STACK_ACCOUNTS) {
      const snapshot = sampleTechSnapshot({ name, domain: 'x.example', rows: [['dns', 'Microsoft 365', 'Collaboration', 0.95, 'Sample: MX points to Microsoft 365']] }, CHECKED);
      expect(snapshot.sample).toBe(true);
      for (const item of snapshot.items) {
        expect(item.source).toMatch(/^open_data:(dns|ct|web|jobs|github)$/);
        expect(item.evidence.url).toBeNull();
        expect(item.evidence.record).toMatch(/^Sample/);
      }
    }
  });

  it('reports found, empty and not run lanes honestly and flows into the stack as sample items', () => {
    const snapshot = sampleTechSnapshot(
      {
        name: 'DNB Bank',
        domain: 'dnb.no',
        rows: [
          ['dns', 'Microsoft 365', 'Collaboration', 0.95, 'Sample: MX'],
          ['jobs', 'Databricks', 'Data', 0.63, 'Sample: named in 1 of 5 public job postings'],
        ],
        empty: ['github'],
      },
      CHECKED,
    );
    const coverage = coverageFromSnapshot(snapshot)!;
    expect(Object.fromEntries(coverage.lanes.map((l) => [l.lane, `${l.status}:${l.count}`]))).toEqual({
      dns: 'found:1',
      ct: 'skipped:0',
      web: 'skipped:0',
      jobs: 'found:1',
      github: 'empty:0',
    });
    expect(coverage.sample).toBe(true);
    expect(snapshot.apolloFallback).toBe('not_configured');
    const items = openTechStackCategories(snapshot).flatMap((c) => c.items);
    expect(items.every((i) => i.sample === true)).toBe(true);
  });
});

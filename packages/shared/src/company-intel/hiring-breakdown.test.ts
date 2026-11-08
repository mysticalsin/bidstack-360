import { describe, expect, it } from 'vitest';

import { hiringBreakdown, postingSkills } from './hiring.js';
import type { HiringSummary } from './types.js';

const summary: HiringSummary = {
  openRoles: 4,
  posted30: 2,
  postedPrev30: 1,
  posted90: 4,
  postedPrev90: 2,
  trend30Pct: 100,
  trend90Pct: 100,
  monthly: [0, 0, 0, 0, 2, 2],
  byFunction: [
    { key: 'data', label: 'Data', count: 3 },
    { key: 'sales', label: 'Sales', count: 1 },
  ],
  skills: [
    { skill: 'Snowflake', count: 2, theme: 'data_ai' },
    { skill: 'Azure', count: 1, theme: 'cloud' },
  ],
  sources: ['greenhouse'],
};

const post = (over: Partial<{ title: string; department: string | null; function: string; seniority: string | null; skills: string[] }>) => ({
  title: 'Role',
  department: null,
  function: 'other',
  seniority: null,
  skills: [],
  ...over,
});

describe('hiring breakdown', () => {
  it('gives function and tech shares of every open role', () => {
    const b = hiringBreakdown(summary, [], (t) => t);
    expect(b.functions).toEqual([
      { key: 'data', label: 'Data', count: 3, pct: 75 },
      { key: 'sales', label: 'Sales', count: 1, pct: 25 },
    ]);
    expect(b.tech.map((t) => [t.label, t.pct])).toEqual([
      ['Snowflake', 50],
      ['Azure', 25],
    ]);
  });

  it('counts a posting once per practice area even when several skills point to it', () => {
    const b = hiringBreakdown(
      summary,
      [
        post({ title: 'Data engineer, Snowflake and Databricks', function: 'data', seniority: 'Senior' }),
        post({ title: 'Azure platform engineer', function: 'infrastructure', seniority: 'Senior' }),
        post({ title: 'Account executive', function: 'sales' }),
      ],
      (t) => (t === 'data_ai' ? 'Data and AI' : t),
    );
    expect(b.themes.find((t) => t.theme === 'data_ai')).toMatchObject({ label: 'Data and AI', count: 1, pct: 33 });
    expect(b.themes.find((t) => t.theme === 'cloud')).toMatchObject({ count: 1 });
    expect(b.seniority).toEqual([
      { key: 'Senior', label: 'Senior', count: 2, pct: 67 },
      { key: 'Not stated', label: 'Not stated', count: 1, pct: 33 },
    ]);
    expect(b.postingsBase).toBe(3);
  });

  it('reads skills from the title as well as stored skills, without duplicates', () => {
    expect(postingSkills({ title: 'Snowflake data engineer', department: 'Azure team', skills: ['Snowflake'] })).toEqual(['Snowflake', 'Azure']);
  });

  it('returns zero shares when there are no open roles', () => {
    const b = hiringBreakdown({ ...summary, openRoles: 0 }, [], (t) => t);
    expect(b.functions.every((f) => f.pct === 0)).toBe(true);
  });
});

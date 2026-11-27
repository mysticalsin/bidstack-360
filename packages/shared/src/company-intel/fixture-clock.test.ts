import { describe, expect, it } from 'vitest';

import { summarizeHiring } from './hiring.js';
import { fixtureClockMode, projectFixturePostings } from './fixture-clock.js';

const NOW = new Date('2026-11-20T00:00:00.000Z');
const LATER = new Date('2027-06-15T00:00:00.000Z');
const SEEN = new Date('2026-08-31T00:00:00.000Z');
const POSTED = new Date('2026-08-29T00:00:00.000Z');

function row(source: string, postedAt: Date = POSTED, lastSeenAt: Date = SEEN) {
  return { id: source, source, postedAt, lastSeenAt, title: 'Engineer', function: 'engineering', department: null, skills: [] as string[], url: null };
}

describe('fixture posting clock', () => {
  it('moves a fixture posting seen 80 days ago to yesterday in demo, and leaves the stored row alone', () => {
    // WHY: open roles count a posting seen within 45 days. A restored demo
    // snapshot keeps the seed dates, so the count later falls to 0.
    const fixture = row('fixture');
    const live = row('greenhouse');
    const rows = [fixture, live];
    const out = projectFixturePostings(rows, NOW, 'demo');

    expect(out[0]!.lastSeenAt).toEqual(new Date('2026-11-19T00:00:00.000Z'));
    expect(out[0]!.postedAt).toEqual(new Date('2026-11-17T00:00:00.000Z'));
    expect(out[1]).toBe(live);
    expect(fixture.lastSeenAt).toEqual(SEEN);
    expect(summarizeHiring(out, NOW).openRoles).toBe(1);
    expect(summarizeHiring(rows, NOW).openRoles).toBe(0);

    const later = projectFixturePostings(rows, LATER, 'demo');
    expect(later[0]!.lastSeenAt).toEqual(new Date('2027-06-14T00:00:00.000Z'));
  });

  it('does not move postings unless the mode is exactly demo', () => {
    const rows = [row('fixture')];
    for (const mode of ['real', 'Demo', 'DEMO', 'demo-x', ' demo', 'notdemo', ''] as const) {
      expect(projectFixturePostings(rows, NOW, mode)).toBe(rows);
    }
    expect(fixtureClockMode(undefined)).toBe('demo');
    expect(fixtureClockMode('demo')).toBe('demo');
    expect(fixtureClockMode('real')).toBe('off');
    expect(fixtureClockMode('Demo')).toBe('off');
  });
});

import { describe, expect, it } from 'vitest';

import {
  fixtureOpenDueInWindow,
  fixtureOpenNotOverdue,
  fixtureOpenShiftDays,
  projectFixtureOpportunityDueDate,
} from './fixture-opportunity-clock.js';

const NOW = new Date('2026-11-27T00:00:00.000Z');
const LATER = new Date('2027-06-15T00:00:00.000Z');
const STILL_AHEAD = new Date('2026-06-28T00:00:00.000Z');

const SEEDED = {
  'OP-2043': '2026-06-30',
  'OP-2041': '2026-07-22',
  'OP-2045': '2026-08-01',
  'OP-2042': '2026-08-15',
  'OP-2048': '2026-09-15',
  'OP-2044': '2026-09-30',
} as const;

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

describe('fixture opportunity due dates', () => {
  it('moves an aged open fixture deal to tomorrow and keeps the gaps', () => {
    // WHY: the seed writes absolute due dates in Jun–Sep 2026. On 2026-11-27
    // every open fixture deal is overdue, so Closing this week is empty.
    // A restored snapshot keeps those dates. The stored row is not rewritten.
    const stored = new Date('2026-06-30T00:00:00.000Z');
    const row = { code: 'OP-2043', stage: 's4_negotiation', dueDate: stored };
    const out = projectFixtureOpportunityDueDate(row, NOW, 'demo');

    expect(out).toEqual(new Date('2026-11-28T00:00:00.000Z'));
    expect(stored.toISOString()).toBe('2026-06-30T00:00:00.000Z');
    expect(out).not.toBe(stored);

    const shift = fixtureOpenShiftDays(NOW);
    expect(projectFixtureOpportunityDueDate({ code: 'OP-2041', stage: 's3_technical_iteration', dueDate: '2026-07-22' }, NOW, 'demo')).toBe(
      addDays('2026-07-22', shift),
    );
    expect(projectFixtureOpportunityDueDate({ code: 'OP-2044', stage: 's1_ongoing', dueDate: SEEDED['OP-2044'] }, NOW, 'demo')).toBe(
      addDays(SEEDED['OP-2044'], shift),
    );

    const window = fixtureOpenDueInWindow(NOW, new Date('2026-12-05T00:00:00.000Z'), NOW, 'demo');
    expect(window.map((row) => row.code)).toEqual(['OP-2043']);
    expect(fixtureOpenNotOverdue(NOW, 'demo').map((row) => row.code)).toEqual(Object.keys(SEEDED));
  });

  it('does not move dates unless the mode is exactly demo, and leaves a live or edited row', () => {
    const fixture = { code: 'OP-2043', stage: 's4_negotiation', dueDate: '2026-06-30' };
    for (const mode of ['real', 'Demo', 'DEMO', 'demo-x', ' demo', 'notdemo', ''] as const) {
      expect(projectFixtureOpportunityDueDate(fixture, NOW, mode)).toBe('2026-06-30');
      expect(fixtureOpenDueInWindow(NOW, LATER, NOW, mode)).toEqual([]);
      expect(fixtureOpenNotOverdue(NOW, mode)).toEqual([]);
    }
    expect(projectFixtureOpportunityDueDate(fixture, NOW, undefined)).toBe('2026-06-30');
    expect(fixtureOpenDueInWindow(NOW, LATER, NOW, 'real')).toEqual([]);
    expect(fixtureOpenNotOverdue(NOW, 'real')).toEqual([]);

    expect(
      projectFixtureOpportunityDueDate({ code: 'OP-9704', stage: 's2_sent', dueDate: '2026-06-30' }, NOW, 'demo'),
    ).toBe('2026-06-30');
    expect(
      projectFixtureOpportunityDueDate({ code: 'OP-2043', stage: 's4_negotiation', dueDate: '2026-12-01' }, NOW, 'demo'),
    ).toBe('2026-12-01');
    expect(
      projectFixtureOpportunityDueDate({ code: 'OP-2043', stage: 'closed_won', dueDate: '2026-06-30' }, NOW, 'demo'),
    ).toBe('2026-06-30');
    expect(
      projectFixtureOpportunityDueDate(
        { code: 'OP-2043', stage: 's4_negotiation', dueDate: '2026-06-30', pipelineStage: { isWon: true, isLost: false } },
        NOW,
        'demo',
      ),
    ).toBe('2026-06-30');

    expect(fixtureOpenShiftDays(STILL_AHEAD)).toBe(0);
    expect(projectFixtureOpportunityDueDate(fixture, STILL_AHEAD, 'demo')).toBe('2026-06-30');
    expect(projectFixtureOpportunityDueDate(fixture, LATER, 'demo')).toBe('2027-06-16');
  });
});

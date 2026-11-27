import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { DEADLINE_THRESHOLD_DAYS, OVERDUE_LOOKBACK_DAYS } from './bid-deadline-alerts.helpers.js';
import {
  FIXTURE_BID_ALERT_DUE_DATES,
  fixtureBidsMissingFromAlertWindow,
  fixtureBidsOutsideAlertWindow,
  projectFixtureBidAlertDue,
} from './bid-deadline-alerts.fixture-due.js';

const NOW = new Date('2026-11-27T12:00:00.000Z');
const LATER = new Date('2027-06-15T00:00:00.000Z');
const STORED_EARLY = new Date('2026-06-30T00:00:00.000Z');
const WIDEST_DAYS = Math.max(...DEADLINE_THRESHOLD_DAYS);
const DAY_MS = 86_400_000;

function windowFor(now: Date): { start: Date; end: Date } {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return {
    start: new Date(today - OVERDUE_LOOKBACK_DAYS * DAY_MS),
    end: new Date(today + WIDEST_DAYS * DAY_MS),
  };
}

describe('fixture bid deadline alert clock', () => {
  it('moves the earliest open fixture bid to tomorrow and keeps the 22-day gap', () => {
    // WHY: the deadline scan compares a stored June date with today. On
    // 2026-11-27 that date is 150 days past, outside the 30-day lookback, so
    // the owner never hears that Rush is due. The card clock slides the same
    // open set so the earliest lands on tomorrow.
    const window = windowFor(NOW);
    const early = { code: 'OP-2043', stage: 's4_negotiation', dueDate: STORED_EARLY };
    const later = {
      code: 'OP-2041',
      stage: 's3_technical_iteration',
      dueDate: new Date('2026-07-22T00:00:00.000Z'),
    };

    expect(projectFixtureBidAlertDue(early, NOW, 'demo')).toEqual(
      new Date('2026-11-28T00:00:00.000Z'),
    );
    expect(projectFixtureBidAlertDue(later, NOW, 'demo')).toEqual(
      new Date('2026-12-20T00:00:00.000Z'),
    );
    expect(early.dueDate).toBe(STORED_EARLY);
    expect(projectFixtureBidAlertDue(early, LATER, 'demo')).toEqual(
      new Date('2027-06-16T00:00:00.000Z'),
    );

    const missing = fixtureBidsMissingFromAlertWindow(NOW, 'demo', window.start, window.end).map(
      (row) => row.code,
    );
    expect(missing).toEqual(['OP-2043']);
    expect(fixtureBidsOutsideAlertWindow(NOW, 'demo', window.start, window.end)).toEqual([]);
  });

  it('leaves a stored date that is inside the lookback out once the slide carries it past the 7-day window', () => {
    // WHY: a July clock still sees the July 22 seed inside the query window.
    // Sliding that row with the June 30 anchor puts it weeks out. It must not
    // keep a batch slot or raise an overdue alert for a date the demo treats
    // as later.
    const now = new Date('2026-07-20T00:00:00.000Z');
    const window = windowFor(now);
    const outside = fixtureBidsOutsideAlertWindow(now, 'demo', window.start, window.end).map(
      (row) => row.code,
    );
    expect(outside).toContain('OP-2041');
    expect(outside).not.toContain('OP-2043');
  });

  it('does not move a bid unless the mode is exactly demo and the row is still the seed', () => {
    const row = { code: 'OP-2043', stage: 's4_negotiation', dueDate: STORED_EARLY };
    const window = windowFor(NOW);
    for (const mode of ['real', 'Demo', 'DEMO', 'demo-x', ' demo', 'notdemo', ''] as const) {
      expect(projectFixtureBidAlertDue(row, NOW, mode)).toBe(STORED_EARLY);
      expect(fixtureBidsMissingFromAlertWindow(NOW, mode, window.start, window.end)).toEqual([]);
      expect(fixtureBidsOutsideAlertWindow(NOW, mode, window.start, window.end)).toEqual([]);
    }
    expect(projectFixtureBidAlertDue(row, NOW, undefined)).toBe(STORED_EARLY);
    const edited = new Date('2026-07-01T00:00:00.000Z');
    expect(projectFixtureBidAlertDue({ ...row, dueDate: edited }, NOW, 'demo')).toBe(edited);
    expect(projectFixtureBidAlertDue({ ...row, stage: 'closed_won' }, NOW, 'demo')).toBe(
      STORED_EARLY,
    );
    expect(projectFixtureBidAlertDue({ ...row, stage: 'closed_lost' }, NOW, 'demo')).toBe(
      STORED_EARLY,
    );
    expect(
      projectFixtureBidAlertDue(
        { ...row, pipelineStage: { isWon: true, isLost: false } },
        NOW,
        'demo',
      ),
    ).toBe(STORED_EARLY);
    expect(projectFixtureBidAlertDue({ ...row, code: 'OP-9999' }, NOW, 'demo')).toBe(STORED_EARLY);
    expect(projectFixtureBidAlertDue(row, new Date('2026-06-30T00:00:00.000Z'), 'demo')).toBe(
      STORED_EARLY,
    );
    expect(
      fixtureBidsMissingFromAlertWindow(
        new Date('2026-06-30T00:00:00.000Z'),
        'demo',
        windowFor(new Date('2026-06-30T00:00:00.000Z')).start,
        windowFor(new Date('2026-06-30T00:00:00.000Z')).end,
      ),
    ).toEqual([]);
  });

  it('lists the same open due dates the seed writes', () => {
    // WHY: the alert clock is a copy of fixtureOpps. A new open date in only
    // one of them ages out of the scan while the other still slides.
    const source = readFileSync(
      path.resolve(import.meta.dirname, '../../../../packages/db/src/seed-data.ts'),
      'utf8',
    );
    const seeded: Record<string, string> = {};
    for (const block of source.split(/code:\s*'/).slice(1)) {
      const code = block.match(/^([^']+)'/)?.[1];
      const due = block.match(/dueDate:\s*'([^']+)'/)?.[1];
      const stage = block.match(/stage:\s*OpportunityStage\.(\w+)/)?.[1];
      if (code && due && stage && stage !== 'closed_won' && stage !== 'closed_lost') {
        seeded[code] = due;
      }
    }
    expect(seeded).toEqual(FIXTURE_BID_ALERT_DUE_DATES);
  });
});

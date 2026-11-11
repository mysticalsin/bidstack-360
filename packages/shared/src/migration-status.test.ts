import { describe, expect, it } from 'vitest';

import {
  MIGRATION_INITIAL_STATUS,
  migrationFromStatuses,
  migrationStatusAfter,
  migrationTransition,
} from './migration-status.js';

const STATUSES = ['PENDING', 'RUNNING', 'COMPLETE', 'FAILED', 'CANCELLED'] as const;
const EVENTS = ['start', 'cancel', 'complete', 'fail', 'undo'] as const;

// The whole graph. A cell is the destination, or '-' when the move is refused.
// This is the pin: adding a transition has to edit this table and say why.
const LEGAL: Record<(typeof EVENTS)[number], Partial<Record<(typeof STATUSES)[number], string>>> = {
  start: { PENDING: 'RUNNING' },
  cancel: { PENDING: 'CANCELLED', RUNNING: 'CANCELLED' },
  complete: { RUNNING: 'COMPLETE' },
  fail: { PENDING: 'FAILED', RUNNING: 'FAILED' },
  undo: { COMPLETE: 'FAILED' },
};

describe('migration job transitions', () => {
  it('allows exactly the moves in the table and no others', () => {
    for (const event of EVENTS) {
      for (const from of STATUSES) {
        const result = migrationTransition(from, event);
        const to = LEGAL[event][from];
        if (to) {
          expect(result, `${from} -${event}->`).toEqual({ ok: true, to });
          expect(migrationStatusAfter(from, event)).toBe(to);
        } else {
          expect(result.ok, `${from} -${event}-> should be refused`).toBe(false);
          expect(() => migrationStatusAfter(from, event)).toThrow(/illegal migration transition/);
        }
      }
    }
  });

  it('refuses a chunk failure to overwrite a job that already finished', () => {
    // WHY: the worker used to write FAILED whenever the entity was unknown,
    // including onto a COMPLETE or CANCELLED row a late chunk found.
    for (const from of ['COMPLETE', 'CANCELLED', 'FAILED'] as const) {
      expect(migrationTransition(from, 'fail').ok).toBe(false);
    }
    expect(migrationFromStatuses('fail')).toEqual(['PENDING', 'RUNNING']);
  });

  it('records where a job is born', () => {
    expect(MIGRATION_INITIAL_STATUS.csv).toBe('PENDING');
    expect(MIGRATION_INITIAL_STATUS.hubspot).toBe('RUNNING');
  });
});

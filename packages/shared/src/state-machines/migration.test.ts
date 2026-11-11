import { describe, expect, it } from 'vitest';

import { isIllegalTransition } from './illegal-transition.js';
import {
  MIGRATION_EVENTS,
  MIGRATION_STATES,
  migrationChunkMayRun,
  migrationFrom,
  migrationStateFromStored,
  migrationTransition,
  migrationUndoStillOpen,
  type MigrationEvent,
  type MigrationState,
} from './migration.js';

const LEGAL: Array<[MigrationState, MigrationEvent, MigrationState]> = [
  ['PENDING', 'start', 'RUNNING'],
  ['PENDING', 'cancel', 'CANCELLED'],
  ['RUNNING', 'cancel', 'CANCELLED'],
  ['RUNNING', 'complete', 'COMPLETE'],
  ['RUNNING', 'fail', 'FAILED'],
  ['COMPLETE', 'undo', 'FAILED'],
];

describe('migration transition table', () => {
  it('accepts every legal row and uses that from-list', () => {
    for (const [from, event, to] of LEGAL) {
      expect(migrationTransition(from, event)).toBe(to);
      expect(migrationFrom(event)).toContain(from);
    }
  });

  it('rejects the full illegal cross product', () => {
    const legal = new Set(LEGAL.map(([from, event]) => `${from}|${event}`));
    for (const from of MIGRATION_STATES) {
      for (const event of MIGRATION_EVENTS) {
        if (legal.has(`${from}|${event}`)) continue;
        expect(isIllegalTransition(migrationTransition(from, event))).toBe(true);
        expect(migrationFrom(event)).not.toContain(from);
      }
    }
  });

  it('allows undo only while the window is still open', () => {
    const now = new Date('2026-11-11T12:00:00.000Z');
    expect(migrationUndoStillOpen(new Date('2026-11-11T12:00:01.000Z'), now)).toBe(true);
    expect(migrationUndoStillOpen(new Date('2026-11-11T11:59:59.000Z'), now)).toBe(false);
    expect(migrationUndoStillOpen(null, now)).toBe(false);
  });

  it('runs a chunk only while the job is running', () => {
    for (const state of MIGRATION_STATES) {
      expect(migrationChunkMayRun(state)).toBe(state === 'RUNNING');
    }
  });

  it('loads a known status as itself and an unknown status as failed without calling it known', () => {
    for (const state of MIGRATION_STATES) {
      expect(migrationStateFromStored(state)).toEqual({ state, known: true });
    }
    expect(migrationStateFromStored('mystery')).toEqual({ state: 'FAILED', known: false });
    expect(migrationStateFromStored('')).toEqual({ state: 'FAILED', known: false });
  });
});

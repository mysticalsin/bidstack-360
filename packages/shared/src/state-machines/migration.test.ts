import { describe, expect, it } from 'vitest';

import { isIllegalTransition } from './illegal-transition.js';
import {
  MIGRATION_EVENTS,
  MIGRATION_STALE_MS,
  MIGRATION_STATES,
  migrationActiveStatus,
  migrationAttemptId,
  migrationChunkMatchesAttempt,
  migrationProgressAt,
  migrationChunkMayRun,
  migrationErrorsCsv,
  migrationEnqueueFailureCode,
  migrationFailureText,
  migrationFrom,
  migrationRetryAllowed,
  migrationRetryOffered,
  migrationStaleDue,
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
  ['FAILED', 'retry', 'RUNNING'],
  ['RUNNING', 'stale', 'FAILED'],
];

describe('migration transition table', () => {
  it('turns a stored failure code into the sentence the error file shows', () => {
    expect(migrationFailureText('enqueue_failed')).toBe('The import did not start. Try again.');
    expect(migrationFailureText('rows_expired')).toBe('Those rows expired. Upload the file again.');
    expect(migrationFailureText('import_conflict')).toBe('The import conflicted with another write.');
    expect(migrationFailureText('import_conflict')).not.toMatch(/will be tried again/);
    expect(
      migrationFailureText('The import conflicted with another write and will be tried again.'),
    ).toBe('The import conflicted with another write.');
    expect(migrationFailureText('Failed to enqueue import chunks')).toBe(
      'The import did not start. Try again.',
    );
    expect(migrationFailureText('Import rows expired. Upload the file again.')).toBe(
      'Those rows expired. Upload the file again.',
    );
    expect(migrationRetryOffered(0, 0, ['enqueue_failed'])).toBe(true);
    expect(migrationRetryOffered(0, 0, ['rows_expired'])).toBe(false);
    expect(migrationRetryOffered(0, 0, ['Import rows expired. Upload the file again.'])).toBe(false);
    expect(migrationRetryOffered(2, 0, ['enqueue_failed'])).toBe(false);
    expect(migrationEnqueueFailureCode(0, 0)).toBe('enqueue_failed');
    expect(migrationEnqueueFailureCode(2, 0)).toBe('enqueue_stopped');
    expect(migrationFailureText('enqueue_stopped')).toBe(
      'The import stopped before the remaining rows were saved.',
    );
    expect(migrationFailureText('company.name is required')).toBe('company.name is required');
    const csv = migrationErrorsCsv([
      { row: 2, field: '=cmd', message: '+sum' },
      { row: 3, field: '-1', message: '@x' },
      { row: 4, field: '\tcell', message: '\rmsg' },
      { row: 5, field: 'name', message: 'company.name is required' },
      {
        row: 6,
        field: 'name',
        message: 'The import conflicted with another write and will be tried again.',
      },
    ]);
    expect(csv).toContain(`"'=cmd"`);
    expect(csv).toContain(`"'+sum"`);
    expect(csv).toContain(`"'-1"`);
    expect(csv).toContain(`"'@x"`);
    expect(csv).toContain('"\'\\tcell"');
    expect(csv).toContain('"\'\\rmsg"');
    expect(csv).not.toContain('"=cmd"');
    expect(csv).toContain('"company.name is required"');
    expect(csv).toContain('"The import conflicted with another write."');
    expect(csv).not.toMatch(/will be tried again/);
  });

  it('takes the status a chunk may write from the fail transition', () => {
    expect(migrationActiveStatus()).toBe(migrationFrom('fail')[0]);
  });

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

  it('retries only a failed job that imported nothing, and marks stale only a running job with no recent progress', () => {
    expect(migrationRetryAllowed(0, 0)).toBe(true);
    expect(migrationRetryAllowed(1, 0)).toBe(false);
    expect(migrationRetryAllowed(0, 1)).toBe(false);
    const now = new Date('2026-11-11T12:00:00.000Z');
    const stale = new Date(now.getTime() - MIGRATION_STALE_MS);
    const fresh = new Date(now.getTime() - MIGRATION_STALE_MS + 1_000);
    expect(
      migrationStaleDue({ state: 'RUNNING', progressAt: stale, processedRows: 0, errorRows: 0, now }),
    ).toBe(true);
    expect(
      migrationStaleDue({ state: 'RUNNING', progressAt: fresh, processedRows: 0, errorRows: 0, now }),
    ).toBe(false);
    expect(
      migrationStaleDue({ state: 'RUNNING', progressAt: stale, processedRows: 1, errorRows: 0, now }),
    ).toBe(false);
    expect(
      migrationStaleDue({ state: 'FAILED', progressAt: stale, processedRows: 0, errorRows: 0, now }),
    ).toBe(false);
    expect(
      migrationStaleDue({ state: 'RUNNING', progressAt: null, processedRows: 0, errorRows: 0, now }),
    ).toBe(false);
    expect(migrationProgressAt({ progressAt: stale.toISOString() })?.toISOString()).toBe(stale.toISOString());
    expect(migrationProgressAt({})).toBeNull();
    expect(migrationProgressAt(null)).toBeNull();
  });

  it('accepts a chunk only from the attempt stored on the job', () => {
    expect(migrationChunkMatchesAttempt(null, null)).toBe(true);
    expect(migrationChunkMatchesAttempt(null, 'attempt-a')).toBe(false);
    expect(migrationChunkMatchesAttempt('attempt-b', 'attempt-a')).toBe(false);
    expect(migrationChunkMatchesAttempt('attempt-b', null)).toBe(false);
    expect(migrationChunkMatchesAttempt('attempt-b', 'attempt-b')).toBe(true);
    expect(migrationAttemptId({ attemptId: 'attempt-b' })).toBe('attempt-b');
    expect(migrationAttemptId({})).toBeNull();
    expect(migrationAttemptId(null)).toBeNull();
  });

  it('runs a chunk only while the job is running', () => {
    for (const state of MIGRATION_STATES) {
      expect(migrationChunkMayRun(state)).toBe(state === 'RUNNING');
    }
  });
});

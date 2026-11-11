import { illegalTransition, type IllegalTransition } from './illegal-transition.js';

export const MIGRATION_STATES = ['PENDING', 'RUNNING', 'COMPLETE', 'FAILED', 'CANCELLED'] as const;
export type MigrationState = (typeof MIGRATION_STATES)[number];

export const MIGRATION_EVENTS = ['start', 'cancel', 'complete', 'fail', 'undo'] as const;
export type MigrationEvent = (typeof MIGRATION_EVENTS)[number];

const FROM: Record<MigrationEvent, readonly MigrationState[]> = {
  start: ['PENDING'],
  cancel: ['PENDING', 'RUNNING'],
  complete: ['RUNNING'],
  fail: ['RUNNING'],
  undo: ['COMPLETE'],
};

const TO: Record<MigrationEvent, MigrationState> = {
  start: 'RUNNING',
  cancel: 'CANCELLED',
  complete: 'COMPLETE',
  fail: 'FAILED',
  undo: 'FAILED',
};

/** Statuses a compare-and-set for this event may match. */
export function migrationFrom(event: MigrationEvent): readonly MigrationState[] {
  return FROM[event];
}

export function migrationTransition(
  from: MigrationState,
  event: MigrationEvent,
): MigrationState | IllegalTransition {
  if (!FROM[event].includes(from)) return illegalTransition();
  return TO[event];
}

/** A chunk may import rows only while the job is running. */
export function migrationChunkMayRun(state: MigrationState): boolean {
  return state === 'RUNNING';
}

/** Undo is allowed only inside the window stored on the job. */
export function migrationUndoStillOpen(undoableUntil: Date | null, now: Date): boolean {
  return undoableUntil !== null && undoableUntil.getTime() > now.getTime();
}

/**
 * An unknown stored value is viewed as failed and is not a known state.
 * Callers do not write that view back.
 */
export function migrationStateFromStored(value: string): { state: MigrationState; known: boolean } {
  if ((MIGRATION_STATES as readonly string[]).includes(value)) {
    return { state: value as MigrationState, known: true };
  }
  return { state: 'FAILED', known: false };
}

import { illegalTransition, type IllegalTransition } from './illegal-transition.js';

export const MIGRATION_STATES = ['PENDING', 'RUNNING', 'COMPLETE', 'FAILED', 'CANCELLED'] as const;
export type MigrationState = (typeof MIGRATION_STATES)[number];

export const MIGRATION_EVENTS = ['start', 'cancel', 'complete', 'fail', 'undo', 'retry', 'stall'] as const;
export type MigrationEvent = (typeof MIGRATION_EVENTS)[number];

/** A running job that has processed nothing for this long is stalled. */
export const MIGRATION_STALL_MS = 15 * 60_000;

const FROM: Record<MigrationEvent, readonly MigrationState[]> = {
  start: ['PENDING'],
  cancel: ['PENDING', 'RUNNING'],
  complete: ['RUNNING'],
  fail: ['RUNNING'],
  undo: ['COMPLETE'],
  retry: ['FAILED'],
  stall: ['RUNNING'],
};

const TO: Record<MigrationEvent, MigrationState> = {
  start: 'RUNNING',
  cancel: 'CANCELLED',
  complete: 'COMPLETE',
  fail: 'FAILED',
  undo: 'FAILED',
  retry: 'RUNNING',
  stall: 'FAILED',
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

/** Retry is the enqueue-failure recovery. A job that already imported rows is not replayed. */
export function migrationRetryAllowed(processedRows: number, errorRows: number): boolean {
  return processedRows === 0 && errorRows === 0;
}

/** A running job with no row progress past the stall window becomes failed. */
export function migrationStallDue(input: {
  state: MigrationState;
  startedAt: Date | null;
  processedRows: number;
  errorRows: number;
  now: Date;
}): boolean {
  if (input.state !== 'RUNNING') return false;
  if (!migrationRetryAllowed(input.processedRows, input.errorRows)) return false;
  if (!input.startedAt) return false;
  return input.now.getTime() - input.startedAt.getTime() >= MIGRATION_STALL_MS;
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

import { illegalTransition, type IllegalTransition } from './illegal-transition.js';

export const MIGRATION_STATES = ['PENDING', 'RUNNING', 'COMPLETE', 'FAILED', 'CANCELLED'] as const;
export type MigrationState = (typeof MIGRATION_STATES)[number];

export const MIGRATION_EVENTS = ['start', 'cancel', 'complete', 'fail', 'undo', 'retry', 'stale'] as const;
export type MigrationEvent = (typeof MIGRATION_EVENTS)[number];

/** A running job with no row progress for this long is stale. */
export const MIGRATION_STALE_MS = 15 * 60_000;

/** Stored on the job when the worker applies the stale transition. */
export const MIGRATION_STALE_REASON = 'stale';

const FROM: Record<MigrationEvent, readonly MigrationState[]> = {
  start: ['PENDING'],
  cancel: ['PENDING', 'RUNNING'],
  complete: ['RUNNING'],
  fail: ['RUNNING'],
  undo: ['COMPLETE'],
  retry: ['FAILED'],
  stale: ['RUNNING'],
};

const TO: Record<MigrationEvent, MigrationState> = {
  start: 'RUNNING',
  cancel: 'CANCELLED',
  complete: 'COMPLETE',
  fail: 'FAILED',
  undo: 'FAILED',
  retry: 'RUNNING',
  stale: 'FAILED',
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

/**
 * A running job that has imported nothing, and whose last progress is at least
 * `MIGRATION_STALE_MS` old, may become failed. Callers pass `updatedAt`: a chunk
 * that commits progress moves that clock, so a stale claim that still holds the
 * old value loses the compare-and-set.
 */
export function migrationStaleDue(input: {
  state: MigrationState;
  progressAt: Date | null;
  processedRows: number;
  errorRows: number;
  now: Date;
}): boolean {
  if (input.state !== 'RUNNING') return false;
  if (!migrationRetryAllowed(input.processedRows, input.errorRows)) return false;
  if (!input.progressAt) return false;
  return input.now.getTime() - input.progressAt.getTime() >= MIGRATION_STALE_MS;
}

/**
 * A chunk belongs to the attempt currently stored on the job.
 * A legacy row with no attempt id only accepts a chunk that also has none.
 */
export function migrationChunkMatchesAttempt(
  jobAttempt: string | null,
  chunkAttempt: string | null,
): boolean {
  if (!jobAttempt) return chunkAttempt == null;
  return chunkAttempt === jobAttempt;
}

/** Read the attempt id stored on a migration job's meta. Missing means legacy. */
export function migrationAttemptId(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const value = (meta as { attemptId?: unknown }).attemptId;
  return typeof value === 'string' && value.length > 0 ? value : null;
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

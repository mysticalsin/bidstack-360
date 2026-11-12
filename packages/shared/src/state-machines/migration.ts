import { illegalTransition, type IllegalTransition } from './illegal-transition.js';

export const MIGRATION_STATES = ['PENDING', 'RUNNING', 'COMPLETE', 'FAILED', 'CANCELLED'] as const;
export type MigrationState = (typeof MIGRATION_STATES)[number];

export const MIGRATION_EVENTS = ['start', 'cancel', 'complete', 'fail', 'undo', 'retry', 'stale'] as const;
export type MigrationEvent = (typeof MIGRATION_EVENTS)[number];

/** A running job with no row progress for this long is stale. */
export const MIGRATION_STALE_MS = 15 * 60_000;

/** Stored on the job when the worker applies the stale transition. */
export const MIGRATION_STALE_REASON = 'stale';

/** Stored on the job when the chunks could not be queued. The wizard keys on this, not on English. */
export const MIGRATION_ENQUEUE_FAILED = 'enqueue_failed';

/** Stored on the job when the uploaded rows are gone from Redis. */
export const MIGRATION_ROWS_EXPIRED = 'rows_expired';

/** Stored when a chunk conflict is not going to be retried. */
export const MIGRATION_CONFLICT = 'import_conflict';

/** Stored when a later page could not be queued after some rows were saved. */
export const MIGRATION_ENQUEUE_STOPPED = 'enqueue_stopped';

/** Sentences written before failure codes existed. The wizard still recognises them. */
export const MIGRATION_LEGACY_ENQUEUE_FAILED = 'Failed to enqueue import chunks';
export const MIGRATION_LEGACY_ROWS_EXPIRED = 'Import rows expired. Upload the file again.';
export const MIGRATION_LEGACY_CONFLICT =
  'The import conflicted with another write and will be tried again.';

const MIGRATION_FAILURE_TEXT: Record<string, string> = {
  [MIGRATION_STALE_REASON]: 'The import stalled before any rows were saved.',
  [MIGRATION_ENQUEUE_FAILED]: 'The import did not start. Try again.',
  [MIGRATION_ENQUEUE_STOPPED]: 'The import stopped before the remaining rows were saved.',
  [MIGRATION_ROWS_EXPIRED]: 'Those rows expired. Upload the file again.',
  [MIGRATION_CONFLICT]: 'The import conflicted with another write.',
  [MIGRATION_LEGACY_CONFLICT]: 'The import conflicted with another write.',
  [MIGRATION_LEGACY_ENQUEUE_FAILED]: 'The import did not start. Try again.',
  [MIGRATION_LEGACY_ROWS_EXPIRED]: 'Those rows expired. Upload the file again.',
};

/** The sentence a downloaded error CSV shows for a stored failure code. A short row sentence passes through. */
export function migrationFailureText(message: string): string {
  const known = MIGRATION_FAILURE_TEXT[message];
  if (known) return known;
  // Same sentences the wizard uses. Driver text is not a row sentence.
  if (
    message.startsWith('chunk failed permanently:') ||
    /PostgresError|\b40P01\b|\b40001\b|\bP2034\b|Unique constraint|\/apps\/|\.ts:\d+|Process \d+/.test(
      message,
    )
  ) {
    return 'The import could not be completed.';
  }
  return message;
}

/** A spreadsheet treats a cell starting with one of these as a formula. */
function migrationCsvCell(value: string): string {
  return JSON.stringify(value.replace(/^(=|\+|-|@|\t|\r)/, "'$1"));
}

/** Error file body. A leading formula character is prefixed so a spreadsheet reads the cell as text. */
export function migrationErrorsCsv(
  errors: readonly { row: number; field: string | null; message: string }[],
): string {
  const header = 'row,field,message';
  if (errors.length === 0) return `${header}\n`;
  const rows = errors.map(
    (error) =>
      `${error.row},${migrationCsvCell(error.field ?? '')},${migrationCsvCell(migrationFailureText(error.message))}`,
  );
  return `${header}\n${rows.join('\n')}`;
}

const FROM: Record<MigrationEvent, readonly MigrationState[]> = {
  start: ['PENDING'],
  cancel: ['PENDING', 'RUNNING'],
  complete: ['RUNNING'],
  fail: ['RUNNING'],
  undo: ['COMPLETE', 'FAILED'],
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

/** The status a chunk may still write. Taken from the fail transition, not a second copy of the word. */
export function migrationActiveStatus(): MigrationState {
  const status = migrationFrom('fail')[0];
  if (status === undefined) throw new Error('migration fail transition has no from-status');
  return status;
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

/** A later page that cannot be queued after rows were saved is not the same as a start that never ran. */
export function migrationEnqueueFailureCode(processedRows: number, errorRows: number): string {
  return processedRows + errorRows > 0 ? MIGRATION_ENQUEUE_STOPPED : MIGRATION_ENQUEUE_FAILED;
}

/** A retry button that would always fail, or that the API would reject, is not offered. */
export function migrationRetryOffered(
  processedRows: number,
  errorRows: number,
  messages: readonly string[],
): boolean {
  if (!migrationRetryAllowed(processedRows, errorRows)) return false;
  return !messages.some(
    (message) => message === MIGRATION_ROWS_EXPIRED || message === MIGRATION_LEGACY_ROWS_EXPIRED,
  );
}

/**
 * A running job that has imported nothing, and whose worker-claim clock is at
 * least `MIGRATION_STALE_MS` old, may become failed. `progressAt` is null while
 * the chunks are still queued: time spent waiting is not a stall. A chunk that
 * commits moves `updatedAt`, so a stale claim that still holds the old value loses.
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

/**
 * When a worker claimed a chunk. Null means the job is still queued and is not stale.
 */
export function migrationProgressAt(meta: unknown): Date | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const value = (meta as { progressAt?: unknown }).progressAt;
  if (typeof value !== 'string' || value.length === 0) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Read the attempt id stored on a migration job's meta. Missing means legacy. */
export function migrationAttemptId(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const value = (meta as { attemptId?: unknown }).attemptId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

// Migration job lifecycle. The status column is what the progress UI polls, so
// every write goes through this table instead of a bare string.
//
// Birth is not a transition: a CSV start is created PENDING (the row exists
// before its chunks are queued) and a HubSpot start is created RUNNING (its
// rows are fetched by the worker, so there is no PENDING phase).
//
// Undo stores FAILED. There is no UNDONE status; the undone flag lives in
// meta.undone. Readers that treat every FAILED job as an error are wrong
// about an undone import. Kept as-is so existing rows and the undo API stay
// the same.

import type { MigrationStatus } from './schemas/migration.js';

export type MigrationEvent = 'start' | 'cancel' | 'complete' | 'fail' | 'undo';

export const MIGRATION_INITIAL_STATUS = {
  csv: 'PENDING',
  hubspot: 'RUNNING',
} as const satisfies Record<string, MigrationStatus>;

const TRANSITIONS: Record<MigrationEvent, { from: readonly MigrationStatus[]; to: MigrationStatus }> = {
  // finishStart, only while the row is still the one this start created.
  start: { from: ['PENDING'], to: 'RUNNING' },
  // DELETE /migrations/:id/cancel. A finished job is refused.
  cancel: { from: ['PENDING', 'RUNNING'], to: 'CANCELLED' },
  // The worker, once processed + error rows cover the total.
  complete: { from: ['RUNNING'], to: 'COMPLETE' },
  // Unsupported entity, or a chunk that used up its retries. PENDING is
  // included because a chunk can die before finishStart moves the row.
  fail: { from: ['PENDING', 'RUNNING'], to: 'FAILED' },
  // DELETE /migrations/:id/undo. See the file comment.
  undo: { from: ['COMPLETE'], to: 'FAILED' },
};

export type MigrationTransition =
  | { ok: true; to: MigrationStatus }
  | { ok: false; from: string; event: MigrationEvent };

export function migrationTransition(from: string, event: MigrationEvent): MigrationTransition {
  const spec = TRANSITIONS[event];
  if ((spec.from as readonly string[]).includes(from)) return { ok: true, to: spec.to };
  return { ok: false, from, event };
}

/** Statuses an event may be applied to. Used as the compare-and-swap filter. */
export function migrationFromStatuses(event: MigrationEvent): readonly MigrationStatus[] {
  return TRANSITIONS[event].from;
}

export function migrationStatusAfter(from: string, event: MigrationEvent): MigrationStatus {
  const result = migrationTransition(from, event);
  if (!result.ok) {
    throw new Error(`illegal migration transition: ${from} -${event}->`);
  }
  return result.to;
}

// Unit tests for the task-due / KAM-staleness alert worker's pure day-math and
// dedupe helpers. WHY these matter: a wrong threshold either misses a real
// deadline (silently drops the "deadline discipline" feature this whole
// cluster exists for) or over-fires, and double-notifying the same (entity,
// day) is alert fatigue — the exact failure that makes people ignore
// deadlines. Every case here encodes one of those two failure modes.
import { describe, expect, it } from 'vitest';

import {
  daysUntilDue,
  daysSince,
  isTaskDueOrOverdue,
  isInitiativeStale,
  KAM_STALE_THRESHOLD_DAYS,
  utcDayKey,
  taskDueDedupeUrl,
  initiativeStaleDedupeUrl,
} from './task-kam-alerts.helpers.js';

const at = (iso: string): Date => new Date(iso);

describe('daysUntilDue', () => {
  it('counts whole UTC calendar days, stable across the clock time within the day', () => {
    // WHY: dueDate is a Postgres `date` (UTC midnight); the same due date must
    // yield the same day-count whether the hourly scan runs at 00:01 or 23:59.
    const due = at('2026-07-05T00:00:00Z');
    expect(daysUntilDue(due, at('2026-07-04T00:01:00Z'))).toBe(1);
    expect(daysUntilDue(due, at('2026-07-04T23:59:00Z'))).toBe(1);
  });

  it('is negative once overdue', () => {
    expect(daysUntilDue(at('2026-07-01T00:00:00Z'), at('2026-07-03T00:00:00Z'))).toBe(-2);
  });
});

describe('isTaskDueOrOverdue', () => {
  it('fires for today, tomorrow, and any overdue count — the "within 24h or overdue" window', () => {
    expect(isTaskDueOrOverdue(0)).toBe(true);
    expect(isTaskDueOrOverdue(1)).toBe(true);
    expect(isTaskDueOrOverdue(-5)).toBe(true);
  });

  it('does not fire for anything further out than tomorrow', () => {
    // WHY (the noise this guards against): a task due in 2+ days is not yet
    // "within 24h" — firing here would nudge the assignee days too early.
    expect(isTaskDueOrOverdue(2)).toBe(false);
    expect(isTaskDueOrOverdue(7)).toBe(false);
  });
});

describe('daysSince / isInitiativeStale', () => {
  it('measures whole days of inactivity and floors at 0 for future timestamps', () => {
    expect(daysSince(at('2026-06-20T00:00:00Z'), at('2026-07-01T00:00:00Z'))).toBe(11);
    expect(daysSince(at('2026-07-05T00:00:00Z'), at('2026-07-01T00:00:00Z'))).toBe(0);
  });

  it('flags stale at the KAM-PLAN §5 default of 14 days, not before', () => {
    // WHY the boundary matters: firing at 13 days is a false-positive nudge on
    // an account that is not actually stale yet; never firing at exactly 14
    // silently drops the very case the rule exists to catch.
    expect(isInitiativeStale(13)).toBe(false);
    expect(isInitiativeStale(KAM_STALE_THRESHOLD_DAYS)).toBe(true);
    expect(isInitiativeStale(30)).toBe(true);
  });
});

describe('utcDayKey + dedupe URLs (idempotency)', () => {
  it('is the same key for two scans within the same UTC day', () => {
    // WHY: the scan is hourly, so the same task/initiative is examined many
    // times within one day — the dedupe key must be stable across those runs
    // or every hourly tick would re-notify the same deadline.
    const morning = at('2026-07-01T01:00:00Z');
    const evening = at('2026-07-01T23:00:00Z');
    expect(utcDayKey(morning)).toBe(utcDayKey(evening));
  });

  it('changes on the next UTC day — a still-overdue/stale entity gets a fresh nudge', () => {
    // WHY: unlike bid-deadline-alerts' once-ever key, these are ongoing
    // nudges — a task still overdue tomorrow must be able to notify again.
    const day1 = utcDayKey(at('2026-07-01T12:00:00Z'));
    const day2 = utcDayKey(at('2026-07-02T12:00:00Z'));
    expect(day1).not.toBe(day2);
  });

  it('task and initiative dedupe URLs are deterministic and never collide across entities', () => {
    const day = '2026-07-01';
    expect(taskDueDedupeUrl('task-1', day)).toBe(taskDueDedupeUrl('task-1', day));
    expect(taskDueDedupeUrl('task-1', day)).not.toBe(taskDueDedupeUrl('task-2', day));
    expect(initiativeStaleDedupeUrl('init-1', day)).not.toBe(taskDueDedupeUrl('init-1', day));
  });
});

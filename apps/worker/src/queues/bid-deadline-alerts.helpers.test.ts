// Unit tests for the bid-deadline alert worker's pure due-detection + dedupe.
// These encode WHY the alerting is correct: thresholds fire exactly at their
// boundary, an opp never gets two alerts for the same threshold (the dedupe key
// is per (opp, threshold)), and overdue opps go silent. The DB-touching scan is
// covered by the worker's own runtime + the existence-check guard.
import { describe, expect, it } from 'vitest';

import {
  DEADLINE_THRESHOLD_DAYS,
  daysUntilDue,
  deadlineDedupeUrl,
  dueInLabel,
  nearestCrossedThreshold,
  thresholdsFor,
} from './bid-deadline-alerts.helpers.js';

const at = (iso: string): Date => new Date(iso);

describe('daysUntilDue', () => {
  it('counts whole UTC calendar days regardless of clock time within the day', () => {
    // WHY: dueDate is a Postgres `date` (UTC midnight); a deadline "in 3 days"
    // must read 3 whether the scan runs at 00:01 or 23:59 of the current day.
    const due = at('2026-06-25T00:00:00Z');
    expect(daysUntilDue(due, at('2026-06-22T00:01:00Z'))).toBe(3);
    expect(daysUntilDue(due, at('2026-06-22T23:59:00Z'))).toBe(3);
  });

  it('is 0 on the due day and negative once overdue', () => {
    const due = at('2026-06-22T00:00:00Z');
    expect(daysUntilDue(due, at('2026-06-22T12:00:00Z'))).toBe(0);
    expect(daysUntilDue(due, at('2026-06-23T12:00:00Z'))).toBe(-1);
  });
});

describe('thresholdsFor', () => {
  it('returns every crossed threshold, closest-first', () => {
    // 7 days out: only the 7d window is open.
    expect(thresholdsFor(7)).toEqual([7]);
    // 3 days out: 7d and 3d are both crossed.
    expect(thresholdsFor(3)).toEqual([7, 3]);
    // 1 day out: all three crossed.
    expect(thresholdsFor(1)).toEqual([7, 3, 1]);
    // due today: all three still crossed (0 <= every threshold).
    expect(thresholdsFor(0)).toEqual([7, 3, 1]);
  });

  it('fires nothing just outside the widest window', () => {
    expect(thresholdsFor(8)).toEqual([]);
  });

  it('fires nothing once overdue — no future deadline left to warn about', () => {
    // WHY: an overdue bid alerting "0 days left" forever would be noise; the
    // window-bounded scan also never fetches these, this is the belt-and-braces.
    expect(thresholdsFor(-1)).toEqual([]);
    expect(thresholdsFor(-30)).toEqual([]);
  });

  it('only ever returns canonical threshold values', () => {
    for (const days of [0, 1, 2, 3, 5, 7]) {
      for (const t of thresholdsFor(days)) {
        expect(DEADLINE_THRESHOLD_DAYS).toContain(t);
      }
    }
  });
});

describe('deadlineDedupeUrl (idempotency key)', () => {
  it('is deterministic per (opportunity, threshold)', () => {
    // WHY this is the no-double-alert guarantee: the worker existence-checks this
    // exact string before insert, so re-running the scan finds the prior alert
    // and skips it. Same inputs MUST yield the same key.
    expect(deadlineDedupeUrl('opp-1', 3)).toBe('/opportunities/opp-1?deadline=3');
    expect(deadlineDedupeUrl('opp-1', 3)).toBe(deadlineDedupeUrl('opp-1', 3));
  });

  it('differs across thresholds and across opportunities', () => {
    expect(deadlineDedupeUrl('opp-1', 7)).not.toBe(deadlineDedupeUrl('opp-1', 3));
    expect(deadlineDedupeUrl('opp-1', 3)).not.toBe(deadlineDedupeUrl('opp-2', 3));
  });

  it('produces a distinct key for each threshold an opp crosses (no collision)', () => {
    // The three alerts an opp gets over its life (7d, 3d, 1d) must each have a
    // unique dedupe key, or the later ones would be suppressed as duplicates.
    const keys = thresholdsFor(1).map((t) => deadlineDedupeUrl('opp-x', t));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('nearestCrossedThreshold', () => {
  it('picks the closest crossed boundary, never the whole crossed set', () => {
    // WHY: an opp first seen already due tomorrow must get ONE alert ("in 1 day"),
    // not simultaneous 7d/3d/1d alerts. Nearest = smallest crossed threshold.
    expect(nearestCrossedThreshold(7)).toBe(7);
    expect(nearestCrossedThreshold(5)).toBe(7); // inside the 7d window only
    expect(nearestCrossedThreshold(3)).toBe(3); // crossed 7d + 3d → nearest 3
    expect(nearestCrossedThreshold(1)).toBe(1);
    expect(nearestCrossedThreshold(0)).toBe(1); // due today → still the 1d bucket
  });

  it('is null outside the widest window and once overdue', () => {
    expect(nearestCrossedThreshold(8)).toBeNull();
    expect(nearestCrossedThreshold(-1)).toBeNull();
  });
});

describe('dueInLabel', () => {
  it('states the real days remaining, not the bucket boundary', () => {
    // WHY (the bug this guards): copy must never claim "in 7 days" for an opp that
    // is actually due in 2 — the label is driven by real daysUntil, not threshold.
    expect(dueInLabel(7)).toBe('in 7 days');
    expect(dueInLabel(3)).toBe('in 3 days');
    expect(dueInLabel(2)).toBe('in 2 days');
    expect(dueInLabel(1)).toBe('in 1 day'); // singular
  });

  it('collapses due-today / overdue to "today"', () => {
    expect(dueInLabel(0)).toBe('today');
    expect(dueInLabel(-3)).toBe('today');
  });
});

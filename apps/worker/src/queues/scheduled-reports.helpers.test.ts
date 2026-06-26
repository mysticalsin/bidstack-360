// Unit tests for the scheduled-reports worker's pure due-detection. These encode
// WHY the cadence is safe: a report runs at most once per cadence (the idempotency
// guarantee), unknown schedule strings never trigger runs, and the everyMinutes
// escape hatch can never busy-loop below the scan interval. The DB-touching scan
// (CAS claim + run row) is covered by the worker's own runtime.
import { describe, expect, it } from 'vitest';

import {
  SCHEDULED_REPORTS_SCAN_INTERVAL_MINUTES,
  cadenceMinutes,
  isReportDue,
} from './scheduled-reports.helpers.js';

const at = (iso: string): Date => new Date(iso);

describe('cadenceMinutes', () => {
  it('maps the human vocabulary, case-insensitively', () => {
    expect(cadenceMinutes('daily')).toBe(1440);
    expect(cadenceMinutes('WEEKLY')).toBe(1440 * 7);
    expect(cadenceMinutes('Monthly')).toBe(1440 * 30);
  });

  it('treats empty / unknown strings as "not scheduled" (null), never a default run', () => {
    // WHY: schedule is a free-form column with no enforced vocabulary; a stray
    // value must NEVER resolve to a cadence and trigger runaway runs.
    expect(cadenceMinutes(null)).toBeNull();
    expect(cadenceMinutes(undefined)).toBeNull();
    expect(cadenceMinutes('')).toBeNull();
    expect(cadenceMinutes('   ')).toBeNull();
    expect(cadenceMinutes('hourly')).toBeNull();
    expect(cadenceMinutes('everyMinutes:')).toBeNull();
    expect(cadenceMinutes('everyMinutes:0')).toBeNull();
    expect(cadenceMinutes('everyMinutes:-5')).toBeNull();
  });

  it('clamps everyMinutes:N up to the scan interval so a small N cannot busy-loop', () => {
    // WHY: the scan only runs every SCAN_INTERVAL minutes; a cadence below that
    // would mark the report due on every single scan. The clamp protects the scan.
    expect(cadenceMinutes('everyMinutes:5')).toBe(SCHEDULED_REPORTS_SCAN_INTERVAL_MINUTES);
    expect(cadenceMinutes('everyMinutes:120')).toBe(120);
  });
});

describe('isReportDue', () => {
  it('is due when never run and the schedule resolves', () => {
    expect(isReportDue('daily', null, at('2026-06-26T00:00:00Z'))).toBe(true);
  });

  it('is never due for an unrecognized schedule, even if never run', () => {
    expect(isReportDue('whenever', null, at('2026-06-26T00:00:00Z'))).toBe(false);
  });

  it('respects the cadence boundary (due only >= one cadence since lastRunAt)', () => {
    // WHY this is the no-double-run guarantee: within a cadence the report is not
    // due; exactly one cadence later it is (boundary inclusive).
    const last = at('2026-06-25T00:00:00Z');
    expect(isReportDue('daily', last, at('2026-06-25T23:59:00Z'))).toBe(false);
    expect(isReportDue('daily', last, at('2026-06-26T00:00:00Z'))).toBe(true);
  });
});

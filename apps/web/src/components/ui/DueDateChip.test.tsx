// A1 (bid clock): boundary coverage for the urgency classification every
// due-date surface (kanban card, list column, detail header, dashboard
// strip) now shares. WHY these exact boundaries: a mis-tinted urgency reads
// as "we're fine" to a bid lead when a deadline has already passed (danger
// misclassified as neutral/warning), or as false alarm when it hasn't
// (warning misclassified as danger) — either way the submission gets
// deprioritized or panicked over for the wrong reason.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DueDateChip, daysUntilDueUtc, dueDateUrgency } from './DueDateChip';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => String(values[key] ?? ''));
    },
  }),
}));

afterEach(cleanup);

// Fixed reference instant so boundary math never flips based on the wall
// clock the test happens to run at.
const NOW = new Date('2026-07-10T15:00:00.000Z');

describe('dueDateUrgency boundaries', () => {
  it('classifies a null dueDate as "none" with no day count', () => {
    expect(dueDateUrgency(null, NOW)).toEqual({ urgency: 'none', tone: 'gray', days: null });
  });

  it('classifies today (0 days out) as warning, not danger and not neutral', () => {
    const info = dueDateUrgency('2026-07-10', NOW);
    expect(info.days).toBe(0);
    expect(info.urgency).toBe('warning');
    expect(info.tone).toBe('amber');
  });

  it('classifies exactly 7 days out as the last warning day (inclusive boundary)', () => {
    const info = dueDateUrgency('2026-07-17', NOW);
    expect(info.days).toBe(7);
    expect(info.urgency).toBe('warning');
  });

  it('classifies 8 days out as neutral — one day past the warning window', () => {
    const info = dueDateUrgency('2026-07-18', NOW);
    expect(info.days).toBe(8);
    expect(info.urgency).toBe('neutral');
    expect(info.tone).toBe('gray');
  });

  it('classifies a past dueDate as danger regardless of how far past', () => {
    const info = dueDateUrgency('2026-07-07', NOW);
    expect(info.days).toBe(-3);
    expect(info.urgency).toBe('danger');
    expect(info.tone).toBe('tomato');
  });

  it('is stable across time-of-day — 11pm vs 1am on the due date both read as "today"', () => {
    const lateNight = new Date('2026-07-10T23:45:00.000Z');
    const earlyMorning = new Date('2026-07-10T00:15:00.000Z');
    expect(daysUntilDueUtc('2026-07-10', lateNight)).toBe(0);
    expect(daysUntilDueUtc('2026-07-10', earlyMorning)).toBe(0);
  });
});

describe('DueDateChip rendering', () => {
  // The component reads the real wall clock (no `now` prop — it's a display
  // component, not a test seam), so these render tests compute "today" /
  // "overdue" relative to actual now rather than a hardcoded date.
  const todayIso = new Date().toISOString().slice(0, 10);

  it('renders "Due today" and carries the absolute date in aria-label', () => {
    render(<DueDateChip dueDate={todayIso} />);
    expect(screen.getByText('Due today')).toBeDefined();
    const chip = screen.getByLabelText(/Due /);
    expect(chip.getAttribute('aria-label')).toContain(new Date(todayIso).getFullYear().toString());
  });

  it('renders the overdue day count as visible text (not color alone — WCAG 1.4.1)', () => {
    render(<DueDateChip dueDate="2020-01-01" />);
    expect(screen.getByText(/d overdue/)).toBeDefined();
  });

  it('renders a graceful "No date" state when the opportunity has no dueDate', () => {
    render(<DueDateChip dueDate={null} />);
    expect(screen.getByText('No date')).toBeDefined();
  });
});

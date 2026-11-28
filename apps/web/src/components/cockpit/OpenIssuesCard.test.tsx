import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RiskItem } from '@bidstack/shared';

import { daysUntilDueUtc } from '@/components/ui/DueDateChip';
import '@/i18n';
import { OpenIssuesCard } from './OpenIssuesCard';

describe('OpenIssuesCard', () => {
  afterEach(cleanup);

  it('says nothing is recorded, not that everything is green, when an account has no rows', () => {
    render(<OpenIssuesCard risks={[]} compliance={[]} />);
    expect(screen.getByText('No open issues')).toBeDefined();
    expect(
      screen.getByText('No risks or compliance checks are recorded for this account yet.'),
    ).toBeDefined();
  });

  it('shows full severity words and the compliance label on rows', () => {
    render(
      <OpenIssuesCard
        risks={[
          { id: 'r1', title: 'Budget freeze', severity: 'high', owner: 'Ana', mitigation: null, dueDate: null, status: 'open' } as never,
        ]}
        compliance={[{ id: 'c1', label: 'DPA unsigned', status: 'blocked', owner: null } as never]}
      />,
    );
    expect(screen.getByText('High', { selector: '.oi-count' })).toBeDefined();
    expect(screen.getByText('Compliance', { selector: '.oi-count' })).toBeDefined();
  });
});

// Demo cockpit fallbacks are "Security scope needs final sign-off" due
// 2026-05-22 and "Incumbent MSP has renewal advantage" due 2026-05-29.
// On a later day those open risks are late. The card used to append the raw
// date, so the row read as a schedule instead of work that has slipped.
const REVIEW_DAY = new Date('2026-11-25T12:00:00.000Z');

function risk(
  partial: Pick<RiskItem, 'id' | 'title' | 'dueDate' | 'status'> & Partial<RiskItem>,
): RiskItem {
  return {
    severity: 'high',
    owner: 'Sarah Bennett',
    mitigation: null,
    ...partial,
  };
}

function rowText(title: string): string {
  const row = screen.getByText(title).closest('li');
  if (!row) throw new Error(`no issue row for ${title}`);
  return row.textContent ?? '';
}

describe('OpenIssuesCard due clock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(REVIEW_DAY);
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('says an open demo risk is overdue instead of printing the raw date', () => {
    // WHY: May 2026 is months before this review day. A raw "2026-05-22"
    // next to the owner looks like the plan, and the bid lead does not see
    // that the sign-off has already slipped.
    const lateBy = Math.abs(daysUntilDueUtc('2026-05-22', REVIEW_DAY));
    render(
      <OpenIssuesCard
        risks={[
          risk({
            id: 'risk-scope',
            title: 'Security scope needs final sign-off',
            dueDate: '2026-05-22',
            status: 'in_progress',
          }),
        ]}
        compliance={[]}
      />,
    );

    const text = rowText('Security scope needs final sign-off');
    expect(text).toContain(`Overdue: ${lateBy}d late`);
    expect(text).not.toContain('2026-05-22');
    expect(text).toContain('May 22, 2026');
    const late = screen.getByText(`Overdue: ${lateBy}d late`);
    expect(late.className).toContain('text-[var(--danger)]');
    expect(late.className).toContain('font-semibold');
  });

  it('does not call a risk due today, or one still ahead, overdue', () => {
    // WHY: the due day itself is still today on the UTC clock. A later date
    // is the schedule. Neither one is late work.
    render(
      <OpenIssuesCard
        risks={[
          risk({
            id: 'today',
            title: 'Confirm the room',
            dueDate: '2026-11-25',
            status: 'open',
          }),
          risk({
            id: 'later',
            title: 'Book the workshop',
            dueDate: '2026-12-20',
            status: 'open',
            severity: 'medium',
          }),
        ]}
        compliance={[]}
      />,
    );

    expect(rowText('Confirm the room')).not.toMatch(/Overdue/);
    expect(rowText('Confirm the room')).not.toContain('2026-11-25');
    expect(rowText('Book the workshop')).not.toMatch(/Overdue/);
    expect(rowText('Book the workshop')).not.toContain('2026-12-20');
  });

  it('leaves a mitigated risk with a past date off the open list', () => {
    // WHY: a closed risk keeps its date as history. It is not an item to action,
    // so it must not wear an overdue clock on this card.
    render(
      <OpenIssuesCard
        risks={[
          risk({
            id: 'done',
            title: 'Archive the brief',
            dueDate: '2026-05-22',
            status: 'mitigated',
          }),
        ]}
        compliance={[]}
      />,
    );

    expect(screen.queryByText('Archive the brief')).toBeNull();
    expect(screen.queryByText(/Overdue/)).toBeNull();
  });
});

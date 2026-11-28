// People tab on a company and on a deal. Demo follow-ups are dated May 2026.
// On a later day each open task is months late, and this list still printed
// "due 2026-05-15" — the same sentence as a task that is still ahead. A bid
// owner reading the account would treat a late follow-up as current.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountWork } from '@bidstack/shared';

import { daysUntilDueUtc } from '@/components/ui/DueDateChip';

import { AccountPeopleSection } from './AccountPeopleSection';

const NOW = new Date('2026-11-25T15:00:00Z');
const COMPANY = '11111111-1111-4111-8111-111111111111';

const work = vi.hoisted(() => ({
  current: {
    data: undefined as AccountWork | undefined,
    isLoading: false,
    isError: false,
    error: null as Error | null,
    refetch: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values[name] ?? ''));
    },
  }),
}));

vi.mock('@/hooks/useAccountPeople', () => ({
  usePeopleMap: () => ({
    data: { companyId: COMPANY, opportunityId: null, people: [] },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useAccountWork: () => work.current,
  useCreateCommitment: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
  useCreatePersonFact: () => ({ mutate: vi.fn(), isPending: false }),
  useDecidePersonFact: () => ({ mutate: vi.fn(), isPending: false }),
}));

function task(
  title: string,
  status: AccountWork['internalTasks'][number]['status'],
  dueDate: string | null,
): AccountWork['internalTasks'][number] {
  return {
    recordKind: 'internal_task',
    id: `00000000-0000-4000-8000-${title.replace(/\W/g, '').slice(0, 12).padEnd(12, '0')}`,
    title,
    dueDate,
    status,
    assigneeEmail: null,
  };
}

function rowText(title: string): string {
  const row = screen.getByText(title).closest('li');
  if (!row) throw new Error(`no row for ${title}`);
  return row.textContent ?? '';
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  work.current = {
    data: {
      commitments: [],
      internalTasks: [
        task('Revise the schedule', 'in_progress', '2026-05-15'),
        task('Send the agenda', 'open', '2026-05-20'),
        task('Chase the signature', 'blocked', '2026-05-12'),
        task('File the debrief', 'done', '2026-05-12'),
        task('Book the workshop', 'open', '2026-12-01'),
        task('Confirm the room', 'open', '2026-11-25'),
        task('Note the owner', 'open', null),
      ],
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('AccountPeopleSection internal tasks', () => {
  it('says an unfinished task past its UTC due day is overdue, and leaves the others on the date', () => {
    render(<AccountPeopleSection companyId={COMPANY} deals={[]} />);

    const lateBy = Math.abs(daysUntilDueUtc('2026-05-15', NOW));
    expect(lateBy).toBeGreaterThan(0);
    expect(rowText('Revise the schedule')).toContain(`Overdue: ${lateBy}d late`);
    expect(rowText('Revise the schedule')).toContain('due 2026-05-15');
    expect(screen.getByText(`Overdue: ${lateBy}d late`).className).toContain('text-[var(--danger)]');

    expect(rowText('Send the agenda')).toContain(
      `Overdue: ${Math.abs(daysUntilDueUtc('2026-05-20', NOW))}d late`,
    );
    expect(rowText('Chase the signature')).toContain(
      `Overdue: ${Math.abs(daysUntilDueUtc('2026-05-12', NOW))}d late`,
    );

    // Finished work keeps its date. Today and a future day are not late.
    // A missing date stays unset. None of those rows borrow the overdue sentence.
    expect(rowText('File the debrief')).toContain('due 2026-05-12');
    expect(rowText('File the debrief')).not.toMatch(/Overdue/);
    expect(rowText('Book the workshop')).toContain('due 2026-12-01');
    expect(rowText('Book the workshop')).not.toMatch(/Overdue/);
    expect(rowText('Confirm the room')).toContain('due 2026-11-25');
    expect(rowText('Confirm the room')).not.toMatch(/Overdue/);
    expect(rowText('Note the owner')).toContain('not set');
    expect(rowText('Note the owner')).not.toMatch(/Overdue/);
  });
});

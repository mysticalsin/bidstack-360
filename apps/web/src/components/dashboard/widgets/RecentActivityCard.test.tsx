import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { activityLateDays } from '@/components/dashboard/activity-late';

import { RecentActivityCard } from './RecentActivityCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values[key] ?? ''));
    },
  }),
}));

afterEach(cleanup);

describe('RecentActivityCard', () => {
  it('shows stage and status codes as readable labels', () => {
    render(
      <MemoryRouter>
        <RecentActivityCard
          activity={[
            {
              type: 'opportunity',
              title: 'Core banking renewal',
              subtitle: 's4_negotiation',
              date: new Date().toISOString(),
              url: '/opportunities/opp-1',
            },
            {
              type: 'task',
              title: 'Send pricing annex',
              subtitle: 'in_progress',
              date: new Date().toISOString(),
              url: null,
            },
          ]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('S4 Negotiation')).toBeTruthy();
    expect(screen.getByText('In Progress')).toBeTruthy();
    expect(screen.queryByText('s4_negotiation')).toBeNull();
  });

  it('does not link to a page that does not exist', () => {
    // WHY: /activities is not a route. A "view all" link lands on Page not found.
    const activity = Array.from({ length: 9 }, (_, index) => ({
      type: 'opportunity',
      title: `Deal ${index}`,
      subtitle: null,
      date: new Date(Date.UTC(2026, 10, 12, index)).toISOString(),
      url: `/opportunities/opp-${index}`,
    }));
    render(
      <MemoryRouter>
        <RecentActivityCard activity={activity} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link', { name: /view all/i })).toBeNull();
    expect(document.querySelector('a[href="/activities"]')).toBeNull();
    expect(screen.getByRole('link', { name: 'Deal 0' })).toBeTruthy();
  });

  it('says an open follow-up is already late and still opens its record', () => {
    // A created-at stamp is not a due date. The May demo follow-ups would
    // otherwise read as ordinary recent activity.
    const dueDate = '2020-01-01';
    const late = activityLateDays({ type: 'task', subtitle: 'in_progress', dueDate });
    render(
      <MemoryRouter>
        <RecentActivityCard
          activity={[
            {
              type: 'task',
              title: 'Submit revised pricing',
              subtitle: 'in_progress',
              date: '2026-05-01T12:00:00.000Z',
              url: '/tasks/task-1',
              dueDate,
            },
          ]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(`${late}d overdue`)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Submit revised pricing' }).getAttribute('href')).toBe(
      '/tasks/task-1',
    );
  });

  it('keeps a follow-up due today, and a won bid, off the late label', () => {
    const today = new Date().toISOString().slice(0, 10);
    render(
      <MemoryRouter>
        <RecentActivityCard
          activity={[
            {
              type: 'task',
              title: 'Due today',
              subtitle: 'open',
              date: '2026-11-25T12:00:00.000Z',
              url: '/tasks/task-today',
              dueDate: today,
            },
            {
              type: 'opportunity',
              title: 'Aritzia — Endpoint Refresh',
              subtitle: 'closed_won',
              date: '2026-04-28T12:00:00.000Z',
              url: '/opportunities/opp-won',
              dueDate: '2020-01-01',
            },
          ]}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/overdue/i)).toBeNull();
  });
});

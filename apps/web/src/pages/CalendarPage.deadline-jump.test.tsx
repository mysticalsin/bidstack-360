import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) => {
      if (!opts) return fallback;
      return Object.entries(opts).reduce(
        (str, [k, v]) => str.replace(`{{${k}}}`, String(v)),
        fallback,
      );
    },
  }),
}));

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

import { CalendarPage } from './CalendarPage';
import { addDays, formatDayLabel, weekKeys } from './calendarPage/layout';

const DAY = { month: 'short', day: 'numeric', year: 'numeric' } as const;

// Tuesday 2026-03-10. The visible week is 2026-03-09 through 2026-03-15, which
// does not contain the demo book's next deadline.
const NOW = new Date('2026-03-10T15:00:00Z');
const NEXT = '2026-04-09';
const PROPOSAL_ID = '22222222-2222-4222-8222-222222222222';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CalendarPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CalendarPage deadline jump', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  function mockBook() {
    apiMock.mockImplementation((url: string) => {
      const href = String(url);
      if (!href.includes('/calendar/deadlines')) return Promise.resolve({ items: [] });
      const query = new URL(href, 'http://localhost').searchParams;
      const from = query.get('from') ?? '';
      const to = query.get('to') ?? '';
      const inRange = from <= NEXT && NEXT < to;
      return Promise.resolve({
        items: inRange
          ? [
              {
                kind: 'proposal',
                id: PROPOSAL_ID,
                name: 'Rail proposal',
                customer: null,
                code: null,
                dueDate: NEXT,
              },
            ]
          : [],
        nearestBefore: null,
        nearestAfter: inRange ? null : NEXT,
      });
    });
  }

  // WHY: an empty week that only says "No deadlines" hides the demo book.
  // The control has to move the visible week onto the next deadline day.
  it('opens the week that holds the next deadline', async () => {
    mockBook();
    renderPage();

    const jump = await screen.findByRole('button', { name: /Next deadline/ });
    expect(jump.getAttribute('data-date')).toBe(NEXT);
    expect(screen.queryByText('No deadlines')).toBeNull();

    fireEvent.click(jump);

    const week = weekKeys(NEXT);
    const range = screen.getByTestId('calendar-range').textContent ?? '';
    expect(range).toContain(formatDayLabel(week[0] ?? NEXT, DAY));
    expect(range).toContain(formatDayLabel(week[6] ?? NEXT, DAY));
    const chip = await screen.findByRole('link', { name: /Rail proposal/ });
    expect(chip.getAttribute('href')).toBe(`/proposals/${PROPOSAL_ID}`);
    expect(screen.queryByRole('button', { name: /Next deadline/ })).toBeNull();
  });

  // WHY: agenda is the other planning view. Leaving it on "No events" makes
  // the same empty book a dead end one click away from the week.
  it('offers the next deadline from the agenda when that range is empty', async () => {
    mockBook();
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Agenda' }));
    const jump = await screen.findByRole('button', { name: /Next deadline/ });
    expect(jump.getAttribute('data-date')).toBe(NEXT);

    fireEvent.click(jump);

    const range = screen.getByTestId('calendar-range').textContent ?? '';
    expect(range).toContain(formatDayLabel(NEXT, DAY));
    expect(range).toContain(formatDayLabel(addDays(NEXT, 13), DAY));
    const chip = await screen.findByRole('link', { name: /Rail proposal/ });
    expect(chip.getAttribute('href')).toBe(`/proposals/${PROPOSAL_ID}`);
    expect(screen.queryByRole('button', { name: /Next deadline/ })).toBeNull();
    expect(screen.queryByText('No events')).toBeNull();
  });
});

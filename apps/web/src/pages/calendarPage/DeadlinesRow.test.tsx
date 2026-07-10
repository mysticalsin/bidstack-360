import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

import { DeadlinesRow } from './DeadlinesRow';

// Frozen clock (Date only — React Query needs real task timers): Tuesday
// 2026-03-10. Deadlines relative to this day exercise all three urgency
// buckets without depending on when the suite runs.
const NOW = new Date('2026-03-10T12:00:00Z');

// Monday 2026-03-09 … Sunday 2026-03-15, built as LOCAL dates the way
// CalendarPage's getWeekDays does.
const WEEK = Array.from({ length: 7 }, (_, i) => new Date(2026, 2, 9 + i));

const DEADLINES = [
  {
    kind: 'opportunity',
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Bridge RFP',
    customer: 'Acme',
    code: 'OP-0001',
    dueDate: '2026-03-09', // yesterday — overdue
  },
  {
    kind: 'proposal',
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Rail proposal',
    customer: null,
    code: null,
    dueDate: '2026-03-10', // today
  },
  {
    kind: 'opportunity',
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Port tender',
    customer: 'Harbor Co',
    code: 'OP-0002',
    dueDate: '2026-03-13', // upcoming — neutral outline
  },
];

function renderRow() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DeadlinesRow days={WEEK} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DeadlinesRow', () => {
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

  // WHY: deadlines must land on the calendar day of their date STRING, deep-
  // link to their record, and carry DueDateChip-consistent urgency. If any of
  // that regresses, the lane misplaces or understates the bid clock — the
  // exact failure this feature exists to prevent.
  it('renders deadline chips in the right day cell, deep-linked, with urgency semantics', async () => {
    apiMock.mockResolvedValue({ items: DEADLINES });

    const { container } = renderRow();

    const overdueChip = await screen.findByRole('link', { name: /overdue/ });
    expect(overdueChip.getAttribute('href')).toBe(
      '/opportunities/11111111-1111-4111-8111-111111111111',
    );
    // Danger token, filled marker — overdue must not read as neutral.
    expect(overdueChip.className).toContain('--danger');
    expect(overdueChip.getAttribute('aria-label')).toContain('Bid deadline');

    const todayChip = screen.getByRole('link', { name: /due today/ });
    expect(todayChip.getAttribute('href')).toBe(
      '/proposals/22222222-2222-4222-8222-222222222222',
    );
    expect(todayChip.className).toContain('--warning');
    expect(todayChip.getAttribute('aria-label')).toContain('Proposal deadline');

    const futureChip = screen.getByRole('link', { name: /Port tender/ });
    expect(futureChip.className).not.toContain('--danger');
    expect(futureChip.className).not.toContain('--warning');

    // Chips bucket by the dueDate string onto the matching local day column.
    const mondayCell = container.querySelector('[data-date="2026-03-09"]');
    expect(mondayCell?.contains(overdueChip)).toBe(true);
    const fridayCell = container.querySelector('[data-date="2026-03-13"]');
    expect(fridayCell?.contains(futureChip)).toBe(true);

    // Entity name is visible — a bare dot on a day answers nothing.
    expect(overdueChip.textContent).toContain('Acme · Bridge RFP');
  });

  // WHY: the API window must be the visible week exactly — [Monday, next
  // Monday). An off-by-one here silently drops Sunday deadlines.
  it('requests the visible week with an exclusive end date', async () => {
    apiMock.mockResolvedValue({ items: [] });

    renderRow();

    await waitFor(() => expect(apiMock).toHaveBeenCalled());
    const [url] = apiMock.mock.calls[0] as [string];
    expect(url).toContain('from=2026-03-09');
    expect(url).toContain('to=2026-03-16');
  });

  it('shows a skeleton lane while loading', () => {
    apiMock.mockReturnValue(new Promise(() => undefined));

    renderRow();

    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('shows an error state with a retry control when the fetch fails', async () => {
    apiMock.mockRejectedValue(new Error('boom'));

    renderRow();

    expect(await screen.findByRole('alert')).toBeTruthy();
    apiMock.mockResolvedValue({ items: DEADLINES });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('link', { name: /overdue/ })).toBeTruthy();
  });

  it('shows an empty state when the week has no deadlines', async () => {
    apiMock.mockResolvedValue({ items: [] });

    renderRow();

    expect(
      await screen.findByText('No bid or proposal deadlines this week.'),
    ).toBeTruthy();
  });
});

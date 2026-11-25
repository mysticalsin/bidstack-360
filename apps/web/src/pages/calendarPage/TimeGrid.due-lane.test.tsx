// WHY: the week grid highlights today in the selected time zone. At 22:00 in
// Toronto on 25 Nov 2026, UTC is already 26 Nov. The Due lane judged "today"
// on the UTC day, so the highlighted column's open bid read as overdue and
// the next UTC day read as due today. A demo week then looks a day late.
import { cleanup, render, screen } from '@testing-library/react';
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

import { TimeGrid } from './TimeGrid';

// 26 Nov 2026 03:00 UTC is 25 Nov 22:00 in Toronto, the calendar's today.
const NOW = new Date('2026-11-26T03:00:00.000Z');
const TODAY = '2026-11-25';

const WEEK = [
  '2026-11-23',
  '2026-11-24',
  '2026-11-25',
  '2026-11-26',
  '2026-11-27',
  '2026-11-28',
  '2026-11-29',
];

const DEADLINES = [
  {
    kind: 'opportunity',
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Bridge bid',
    customer: 'Northwind',
    code: 'OP-2041',
    dueDate: '2026-11-25',
  },
  {
    kind: 'proposal',
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Annex review',
    customer: null,
    code: null,
    dueDate: '2026-11-26',
  },
];

function renderWeek() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TimeGrid
          keys={WEEK}
          tz="America/Toronto"
          events={[]}
          todayKey={TODAY}
          showDeadlines
          onSlot={() => {}}
          onSelect={() => {}}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Due lane on the calendar today', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    cleanup();
    apiMock.mockReset();
  });

  it('keeps today on the highlighted day when UTC has already moved on', async () => {
    apiMock.mockResolvedValue({ items: DEADLINES });
    const { container } = renderWeek();

    const todayChip = await screen.findByRole('link', { name: /Bridge bid/ });
    const todayLabel = todayChip.getAttribute('aria-label') ?? '';
    expect(todayLabel).toContain('due today');
    expect(todayLabel).not.toContain('overdue');
    expect(container.querySelector('[data-date="2026-11-25"]')?.contains(todayChip)).toBe(true);

    const nextChip = screen.getByRole('link', { name: /Annex review/ });
    const nextLabel = nextChip.getAttribute('aria-label') ?? '';
    expect(nextLabel).not.toContain('due today');
    expect(nextLabel).not.toContain('overdue');
    expect(container.querySelector('[data-date="2026-11-26"]')?.contains(nextChip)).toBe(true);
  });
});

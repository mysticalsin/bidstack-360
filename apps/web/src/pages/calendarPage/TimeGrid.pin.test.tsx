// WHY: the hour grid opens at 07:00. That scroll used to include the all-day
// lane and the deadlines row, so both left the screen. A demo week often has
// no timed meeting. The lane is the only signal that the week is not empty,
// and a blank 07:00 grid read as a free week.
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) =>
      opts
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(opts[k] ?? ''))
        : fallback,
  }),
}));

vi.mock('@/lib/api', () => ({
  api: vi.fn(() => Promise.resolve({ items: [] })),
}));

import { TimeGrid } from './TimeGrid';
import type { CalendarEvent } from './types';

/** 07:00, the hour the grid opens on. Hour rows are 48px. */
const OPEN_AT_SEVEN = 7 * 48;

const WEEK = [
  '2026-11-23',
  '2026-11-24',
  '2026-11-25',
  '2026-11-26',
  '2026-11-27',
  '2026-11-28',
  '2026-11-29',
];

function hold(): CalendarEvent {
  return {
    id: 'hold',
    subject: 'Site hold',
    startAt: '2026-11-25T00:00:00.000Z',
    endAt: '2026-11-26T00:00:00.000Z',
    location: null,
    isAllDay: true,
    syncState: 'SYNCED',
    provider: 'google_workspace',
    createdAt: '2026-11-01T00:00:00.000Z',
    contactId: null,
    companyId: null,
    opportunityId: null,
    localOnly: true,
  };
}

function pinOf(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    if (node.classList.contains('sticky')) return node;
    node = node.parentElement;
  }
  return null;
}

function renderGrid(events: CalendarEvent[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TimeGrid
          keys={WEEK}
          tz="UTC"
          events={events}
          todayKey="2026-11-25"
          showDeadlines
          onSlot={() => {}}
          onSelect={() => {}}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => cleanup());

describe('TimeGrid pinned lane', () => {
  it('keeps an all-day bar on screen when the hours open at 07:00', () => {
    renderGrid([hold()]);
    const grid = screen.getByTestId('calendar-grid');
    expect(grid.scrollTop).toBe(OPEN_AT_SEVEN);

    const bar = screen.getByRole('button', { name: /Site hold/ });
    const pin = pinOf(bar);
    expect(pin?.classList.contains('sticky')).toBe(true);
    expect(pin ? grid.contains(pin) : false).toBe(true);
  });

  it('keeps the deadlines lane on screen when the week has no timed meeting', () => {
    renderGrid([]);
    const grid = screen.getByTestId('calendar-grid');
    expect(grid.scrollTop).toBe(OPEN_AT_SEVEN);

    const due = screen.getByText('Due');
    const pin = pinOf(due);
    expect(pin?.classList.contains('sticky')).toBe(true);
    expect(pin ? grid.contains(pin) : false).toBe(true);
  });
});

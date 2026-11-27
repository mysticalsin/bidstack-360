// WHY: demo (and every org, while calendar writes are off) stores a new event
// with a provider label and localOnly. The Google and Microsoft chips must
// mean "on that calendar". A Polo-only block must not wear the Google color
// or stay on screen when Google is selected.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));
vi.mock('@/components/ai/MeetingPrepCard', () => ({ MeetingPrepCard: () => null }));

import { CalendarPage } from './CalendarPage';
import type { CalendarEvent } from './calendarPage/types';

function event(over: Partial<CalendarEvent>): CalendarEvent {
  const start = new Date(Date.now() + 60 * 60 * 1000);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  return {
    id: 'e1',
    subject: 'Standup',
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    location: null,
    isAllDay: false,
    syncState: 'SYNCED',
    provider: 'google_workspace',
    createdAt: '2026-03-01T00:00:00Z',
    contactId: null,
    companyId: null,
    opportunityId: null,
    localOnly: false,
    ...over,
  };
}

const POLO = event({ id: 'polo', subject: 'Pricing review', localOnly: true, provider: 'google_workspace' });
const GOOGLE = event({ id: 'google', subject: 'Kickoff', localOnly: false, provider: 'google_workspace' });

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

describe('Calendar provider filter', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('keeps a Polo-only event out of the Google and Microsoft calendars', async () => {
    apiMock.mockImplementation((url: string) => {
      if (String(url).includes('/calendar/events')) return Promise.resolve({ items: [POLO, GOOGLE] });
      return Promise.resolve({ items: [] });
    });

    renderPage();

    const polo = await screen.findByRole('button', { name: /Pricing review/ });
    const kickoff = screen.getByRole('button', { name: /Kickoff/ });
    expect(polo.className).toContain('bg-gray-600');
    expect(polo.className).not.toContain('bg-blue-600');
    expect(kickoff.className).toContain('bg-blue-600');

    fireEvent.click(screen.getByRole('button', { name: 'Google' }));
    expect(screen.queryByRole('button', { name: /Pricing review/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Kickoff/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Microsoft' }));
    expect(screen.queryByRole('button', { name: /Kickoff/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByRole('button', { name: /Pricing review/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Kickoff/ })).toBeTruthy();
  });
});

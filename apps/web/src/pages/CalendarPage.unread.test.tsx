// A paused or in-flight calendar read has no events yet. Week and day still
// drew open hours, and agenda still said No events. A payload with no list
// did the same. None of those is a free day.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) =>
      opts ? fallback.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(opts[k] ?? '')) : fallback,
  }),
}));

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof import('@/lib/api')>();
  return { ...real, api: apiMock };
});

vi.mock('@/components/ai/MeetingPrepCard', () => ({ MeetingPrepCard: () => null }));

vi.mock('./calendarPage/DeadlinesRow', () => ({ DeadlinesRow: () => null }));

import { CalendarPage } from './CalendarPage';

const CHECKING = 'Checking events. They have not arrived.';
const EMPTY = 'No events';
const FAILED = 'Could not load events';
const SUBJECT = 'Harbor review';

function renderCalendar() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CalendarPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function todayEvent() {
  const day = new Date().toISOString().slice(0, 10);
  return {
    id: 'e1',
    subject: SUBJECT,
    startAt: `${day}T15:00:00.000Z`,
    endAt: `${day}T15:30:00.000Z`,
    location: null,
    isAllDay: false,
    syncState: 'SYNCED',
    provider: 'google_workspace',
    createdAt: `${day}T12:00:00.000Z`,
    contactId: null,
    companyId: null,
    opportunityId: null,
    localOnly: false,
  };
}

function expectNoSettledClaim() {
  expect(screen.queryByRole('heading', { name: EMPTY })).toBeNull();
  expect(screen.queryByTestId('calendar-grid')).toBeNull();
  expect(screen.queryByTestId('calendar-agenda')).toBeNull();
  expect(screen.queryAllByRole('button', { name: /New event .+ at / })).toHaveLength(0);
  expect(screen.queryByText(SUBJECT)).toBeNull();
}

afterEach(() => {
  cleanup();
  apiMock.mockReset();
  onlineManager.setOnline(true);
});

describe('Calendar events that have not arrived are not a free day', () => {
  it('does not call a paused read an empty week, day, or agenda', () => {
    // WHY: a paused first read has isLoading false and no payload. The week
    // and day still offered open hours, and agenda still said No events.
    onlineManager.setOnline(false);
    apiMock.mockImplementation(() => new Promise(() => undefined));
    renderCalendar();

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expectNoSettledClaim();
    expect(screen.queryByRole('heading', { name: FAILED })).toBeNull();
    expect(apiMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Day' }));
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expectNoSettledClaim();

    fireEvent.click(screen.getByRole('button', { name: 'Agenda' }));
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expectNoSettledClaim();
  });

  it('does not call an in-flight read an empty week', () => {
    // WHY: a slow read showed only the loading skeleton. Open hours and
    // No events both read as a day the book already confirmed.
    onlineManager.setOnline(true);
    apiMock.mockImplementation(() => new Promise(() => undefined));
    renderCalendar();

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByLabelText('Loading calendar')).toBeNull();
    expectNoSettledClaim();
    expect(screen.queryByRole('heading', { name: FAILED })).toBeNull();
  });

  it('does not call a payload with no event list a free day', async () => {
    // WHY: success with no items array is not an empty book. The week must
    // not offer open hours for a list that never arrived.
    onlineManager.setOnline(true);
    apiMock.mockResolvedValue({});
    renderCalendar();

    expect(await screen.findByRole('heading', { name: FAILED })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expectNoSettledClaim();
  });

  it('still says a failed read could not load events', async () => {
    // WHY: a thrown read stays on the error. It is not No events, and it is
    // not a grid of open hours.
    onlineManager.setOnline(true);
    apiMock.mockRejectedValue(new Error('calendar down'));
    renderCalendar();

    expect(await screen.findByRole('heading', { name: FAILED })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expectNoSettledClaim();
  });

  it('still says there are no events when the empty agenda has arrived', async () => {
    // WHY: a settled empty list is a real empty agenda. The checking line
    // must not replace it.
    onlineManager.setOnline(true);
    apiMock.mockResolvedValue({ items: [] });
    renderCalendar();
    fireEvent.click(screen.getByRole('button', { name: 'Agenda' }));

    expect(await screen.findByRole('heading', { name: EMPTY })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('heading', { name: FAILED })).toBeNull();
    expect(screen.queryByTestId('calendar-grid')).toBeNull();
  });

  it('still shows open hours after an empty day has arrived', async () => {
    // WHY: a settled empty day is free. Those hours stay, so a real free day
    // is not dressed up as a slow network.
    onlineManager.setOnline(true);
    apiMock.mockResolvedValue({ items: [] });
    renderCalendar();
    fireEvent.click(screen.getByRole('button', { name: 'Day' }));

    expect(await screen.findByTestId('calendar-grid')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /New event .+ at / }).length).toBeGreaterThan(0);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('heading', { name: EMPTY })).toBeNull();
    expect(screen.queryByRole('heading', { name: FAILED })).toBeNull();
  });

  it('still shows an event that has arrived', async () => {
    // WHY: a loaded event stays on the week. The checking line must not
    // replace a read the calendar already returned.
    onlineManager.setOnline(true);
    apiMock.mockResolvedValue({ items: [todayEvent()] });
    renderCalendar();

    expect(await screen.findByText(SUBJECT)).toBeTruthy();
    expect(screen.getByTestId('calendar-grid')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('heading', { name: EMPTY })).toBeNull();
    expect(screen.queryByRole('heading', { name: FAILED })).toBeNull();
  });
});

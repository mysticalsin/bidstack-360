// A failed availability read has no schedule. The page said the scheduling
// link was invalid. A failed read is not an invalid link, and it is not an
// empty day. A read that has not settled is not those either.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const translate = vi.hoisted(
  () => (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
}));
vi.mock('@/lib/api', () => ({
  buildApiUrl: (path: string) => `https://api.example${path}`,
}));

import { PublicBookingPage } from './PublicBookingPage';

const FAILED = 'Could not load this booking page.';
const NOT_FOUND = 'Booking page not found';
const INVALID = 'This scheduling link is invalid or no longer accepting meetings.';
const EMPTY = 'No available slots on this day. Try another date.';
const LOADING = 'Loading booking page';
const LOADED = 'BidStack discovery call';

const PAGE = {
  slots: ['2026-11-27T15:00:00.000Z'],
  durationMinutes: 30,
  name: LOADED,
  description: 'A public scheduling page used to verify booking availability and slot creation.',
  customQuestions: [],
};

const fetchMock = vi.fn();

function renderBooking() {
  return render(
    <MemoryRouter initialEntries={['/book/test-slug']}>
      <Routes>
        <Route path="/book/:slug" element={<PublicBookingPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function expectNoSettledClaim() {
  expect(screen.queryByRole('heading', { name: NOT_FOUND })).toBeNull();
  expect(screen.queryByText(INVALID)).toBeNull();
  expect(screen.queryByText(EMPTY)).toBeNull();
  expect(screen.queryByText(LOADED)).toBeNull();
}

describe('PublicBookingPage failed availability read', () => {
  afterEach(() => {
    cleanup();
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('does not call a failed network read an invalid or empty schedule', async () => {
    // WHY: the browser never got a booking page. The link is not invalid,
    // and the day is not empty. Demo visitors on test-slug must see a load failure.
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    renderBooking();

    expect(await screen.findByRole('heading', { name: FAILED })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expectNoSettledClaim();
    expect(screen.queryByText('Failed to fetch')).toBeNull();
  });

  it('does not call an HTTP failure an invalid or empty schedule', async () => {
    // WHY: a 500 is the server failing the read. It is not a 404, so the page
    // must not say the scheduling link is invalid or no longer accepting meetings.
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: 'upstream unavailable' }), { status: 500 }),
    );
    renderBooking();

    expect(await screen.findByRole('heading', { name: FAILED })).toBeTruthy();
    expectNoSettledClaim();
    expect(screen.queryByText('upstream unavailable')).toBeNull();
  });

  it('does not call an in-flight availability read an empty day or an invalid link', async () => {
    // WHY: a read that has not settled has no slots yet. The loading title
    // stays. The page must not say the day is empty or the link is invalid.
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(() => new Promise(() => {}));
    renderBooking();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByRole('heading', { name: LOADING })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: FAILED })).toBeNull();
    expectNoSettledClaim();
  });

  it('still shows a link the server says is missing', async () => {
    // WHY: a settled 404 is a missing page. That sentence stays, so a real
    // miss is not dressed up as a slow network.
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: 'Booking page not found' }), { status: 404 }),
    );
    renderBooking();

    expect(await screen.findByRole('heading', { name: NOT_FOUND })).toBeTruthy();
    expect(screen.getByText(INVALID)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: FAILED })).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(LOADED)).toBeNull();
  });

  it('still shows a schedule that has arrived', async () => {
    // WHY: a loaded demo page stays on the page. The failure line must not
    // replace a schedule the read already returned.
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(new Response(JSON.stringify(PAGE), { status: 200 }));
    renderBooking();

    expect(await screen.findByRole('heading', { name: LOADED })).toBeTruthy();
    expect(screen.getByTestId('time-slot')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: FAILED })).toBeNull();
    expect(screen.queryByRole('heading', { name: NOT_FOUND })).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it('still shows an empty day after the schedule arrives with no slots', async () => {
    // WHY: a settled empty day is a real empty day. The failure line must not
    // replace it, and the missing-link line must not replace it.
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ...PAGE, slots: [] }), { status: 200 }),
    );
    renderBooking();

    expect(await screen.findByText(EMPTY)).toBeTruthy();
    expect(screen.getByRole('heading', { name: LOADED })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: FAILED })).toBeNull();
    expect(screen.queryByRole('heading', { name: NOT_FOUND })).toBeNull();
    expect(screen.queryByText(INVALID)).toBeNull();
  });
});

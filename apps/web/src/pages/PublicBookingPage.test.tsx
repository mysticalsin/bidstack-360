import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock('@/lib/api', () => ({
  buildApiUrl: (path: string) => `https://api.example${path}`,
}));

import { PublicBookingPage } from './PublicBookingPage';

const fetchMock = vi.fn(async () => new Response(JSON.stringify({ slots: [] }), { status: 200 }));

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/book/intro']}>
      <Routes>
        <Route path="/book/:slug" element={<PublicBookingPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PublicBookingPage', () => {
  // WHY: the day list is what a guest hears and what the availability call
  // asks for. At 20:00 in Toronto on 25 Nov 2026, UTC is already 26 Nov.
  // Building that day with toISOString() speaks Friday 27 Nov and requests
  // that date. Tomorrow in Toronto is Thursday 26 Nov.
  it('speaks tomorrow in the viewer zone when UTC has already moved on', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-26T01:00:00.000Z'));
    const real = Intl.DateTimeFormat.prototype.resolvedOptions;
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (
      this: Intl.DateTimeFormat,
    ) {
      return { ...real.call(this), timeZone: 'America/Toronto' };
    });

    try {
      renderPage();
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const url = String((fetchMock.mock.calls[0] as unknown as [string])[0]);
      expect(url).toContain('date=2026-11-26');
      expect(url).not.toContain('date=2026-11-27');

      const firstDay = screen.getAllByRole('button', { name: /Nov/ })[0];
      expect(firstDay?.textContent).toMatch(/Nov 26/);
      expect(firstDay?.textContent).not.toMatch(/Nov 27/);
      expect(firstDay?.textContent).toMatch(/Thursday/);
    } finally {
      spy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('asks the API origin for availability, with the slug encoded', async () => {
    render(
      <MemoryRouter initialEntries={['/book/team%20intro']}>
        <Routes>
          <Route path="/book/:slug" element={<PublicBookingPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = String((fetchMock.mock.calls[0] as unknown as [string])[0]);
    expect(url.startsWith('https://api.example/api/v1/booking-pages/team%20intro/availability?')).toBe(true);
  });
});

import { cleanup, render, waitFor } from '@testing-library/react';
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

describe('PublicBookingPage', () => {
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

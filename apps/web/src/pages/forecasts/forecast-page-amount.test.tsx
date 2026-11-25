import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ForecastsPage } from '../ForecastsPage';
import { forecastPageAmount } from './forecast-page-amount';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

const capabilitiesMocks = vi.hoisted(() => ({ useHasPermission: vi.fn(() => true) }));
vi.mock('@/hooks/useCapabilities', () => capabilitiesMocks);

const forecastsMocks = vi.hoisted(() => ({
  useForecastProjection: vi.fn(() => ({ data: undefined, isLoading: false, isError: false })),
  useForecasts: vi.fn(),
  useCreateForecast: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useDeleteForecast: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
}));
vi.mock('@/hooks/useForecasts', () => forecastsMocks);

const usersMocks = vi.hoisted(() => ({ useUsers: vi.fn(() => ({ data: [] })) }));
vi.mock('@/hooks/useUsers', () => usersMocks);

vi.mock('@/hooks/useFormatMoney', () => ({
  useFormatMoney: () => ({
    formatMoneyMicros: (micros: number) => `€${(micros / 1_000_000).toLocaleString('en-US')}`,
  }),
}));

const UNITS_61520_MICROS = 61_520_000_000;

function digits(text: string): string {
  return text.replace(/\D/g, '');
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<ForecastsPage />, { wrapper: Wrapper });
}

describe('forecast page totals under demo data', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not price a forecast total of 61520 as euros', () => {
    // WHY: the page totals sum category amountMicros and print that integer as
    // euros. The headline total does not carry a currency. Demo synthetic data
    // sent 61520 units through an EUR formatter, so Commit read as a euro
    // forecast. The figure stays 61520 and does not name EUR. The chart, the
    // list, and the projection stay on their own formatters.
    forecastsMocks.useForecasts.mockReturnValue({
      data: {
        items: [
          {
            id: 'f-61520',
            orgId: 'org-1',
            ownerId: 'owner-1',
            ownerName: 'Alex Example',
            period: '2026-08',
            category: 'commit',
            amountMicros: UNITS_61520_MICROS,
            currency: 'EUR',
            note: null,
            createdAt: '2026-08-01T00:00:00.000Z',
            updatedAt: '2026-08-01T00:00:00.000Z',
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    const totals = screen.getByLabelText(/Forecast totals for the selected period/i);
    const commit = within(totals).getByText('Commit');
    const figure = commit.nextElementSibling?.textContent ?? '';
    expect(figure).not.toMatch(/EUR|€/);
    expect(digits(figure)).toBe('61520');
  });

  it('does not invent a euro zero when the micros are not a safe integer', () => {
    // WHY: a page total that is not an integer micros value is not an amount.
    // It must not fall through to an EUR zero.
    expect(forecastPageAmount(Number.NaN)).toBe('Not a number');
    expect(forecastPageAmount(1.5)).toBe('Not a number');
    expect(forecastPageAmount('nope')).toBe('Not a number');
    expect(forecastPageAmount(Number.NaN)).not.toMatch(/EUR|€/);
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';

import { useForecastProjection } from './useForecasts';

vi.mock('@/lib/api', () => ({
  api: vi.fn(),
}));

// Demo IKEA (OP-0002, Cloud Migration & FinOps) is 850,000 at 75% on the bid.
// The projection still weights negotiation at the stage rate of 80% until a
// reread, which is 680,000. The app cache treats a query as fresh for 2 minutes.
const IKEA_VALUE = 850_000 * 1_000_000;
const WEIGHT_AT_STAGE_RATE = 680_000 * 1_000_000;
const WEIGHT_AT_BID_RATE = 637_500 * 1_000_000;

const cachedProjection = {
  currency: 'EUR',
  generatedAt: '2026-11-25T12:00:00.000Z',
  periods: [
    {
      period: '2027-Q1',
      label: 'Q1 2027',
      openMicros: IKEA_VALUE,
      weightedMicros: WEIGHT_AT_STAGE_RATE,
      wonMicros: 0,
      manualCommitMicros: null,
      byOwner: [],
    },
  ],
};

const rereadProjection = {
  ...cachedProjection,
  periods: [{ ...cachedProjection.periods[0], weightedMicros: WEIGHT_AT_BID_RATE }],
};

function harness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 120_000 },
      mutations: { retry: false },
    },
  });
  queryClient.setQueryData(['forecast-projection'], cachedProjection);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('useForecastProjection weight cache', () => {
  it('rereads the weight when the forecast page opens inside the 2-minute cache', async () => {
    // WHY: saving a stage rate, or moving IKEA off negotiation, happens on
    // another screen and does not drop this query. The forecast page must not
    // keep 680,000 for the next two minutes.
    const { wrapper } = harness();
    vi.mocked(api).mockResolvedValue(rereadProjection);

    const { result } = renderHook(() => useForecastProjection({ rereadOnOpen: true }), { wrapper });

    await waitFor(() => {
      expect(result.current.data?.periods[0]?.weightedMicros).toBe(WEIGHT_AT_BID_RATE);
    });
    expect(api).toHaveBeenCalledWith('/api/forecasts/projection', expect.anything());
  });

  it('answers a fresh cached weight for the home dashboard', () => {
    // The home dashboard reads the same query with no options. A fresh cache
    // still answers without a new request.
    const { wrapper } = harness();
    vi.mocked(api).mockResolvedValue(rereadProjection);

    const { result } = renderHook(() => useForecastProjection(), { wrapper });

    expect(result.current.data?.periods[0]?.weightedMicros).toBe(WEIGHT_AT_STAGE_RATE);
    expect(api).not.toHaveBeenCalled();
  });
});

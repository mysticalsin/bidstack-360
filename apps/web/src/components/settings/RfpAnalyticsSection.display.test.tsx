// The pipeline figure has no currency. A dollar glyph next to it reads as USD.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RfpAnalyticsSection } from './RfpAnalyticsSection';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/lib/api', () => ({
  api: vi.fn(async () => ({
    totalCount: 2,
    wonCount: 1,
    lostCount: 0,
    totalValueMicros: '2500000000000',
    byStatus: [],
    byOwner: [],
  })),
}));

afterEach(() => {
  cleanup();
});

describe('RfpAnalyticsSection pipeline tile', () => {
  it('does not put a dollar glyph beside an unspecified pipeline figure', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <RfpAnalyticsSection />
      </QueryClientProvider>,
    );

    const label = await screen.findByText('Pipeline value');
    const card = label.closest('.p-4');
    const path = card?.querySelector('path');
    // Dollar glyph path starts with a vertical stroke through the S-curve.
    expect(path?.getAttribute('d') ?? '').not.toContain('M12 2v20');
    expect(await screen.findByText(/unspecified/)).toBeDefined();
    expect(screen.getByText(/currency not recorded/)).toBeDefined();
  });
});

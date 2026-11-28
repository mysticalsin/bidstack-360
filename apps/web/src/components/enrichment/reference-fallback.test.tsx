// The fixture builder leaves notice null. The strip then has to say the
// firmographics are reference records. sample stays true, and the chip stays
// Reference. This path does not wait on a provider status string.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  useCompanyEnrichment: vi.fn(),
}));

vi.mock('@/hooks/useCompanyEnrichment', () => ({
  useCompanyEnrichment: hooks.useCompanyEnrichment,
  useRefreshEnrichment: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    pollUntil: undefined,
  }),
  awaitingRefresh: () => false,
}));
vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: () => false }));

import { mockEnrichment } from '@/lib/enrichment/mock';

import { FirmographicsStrip } from './FirmographicsStrip';

const DEMO_COPY = /\bsample\b|\billustrative\b|\blive\b/i;

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('firmographics fallback when the fixture has no notice', () => {
  it('shows reference records and keeps sample true', () => {
    const data = mockEnrichment('acct-1');
    expect(data.sample).toBe(true);
    expect(data.notice).toBeNull();
    hooks.useCompanyEnrichment.mockReturnValue({ data, dataUpdatedAt: 1_700_000_000_000 });

    wrap(<FirmographicsStrip companyId="acct-1" />);
    const strip = screen.getByTestId('account-firmographics');
    const status = within(strip).getByRole('status');

    expect(status.textContent).toContain('Reference records until company enrichment is connected.');
    expect(within(strip).getByText('Reference').getAttribute('title')).toBe(
      'Reference records until company enrichment is connected',
    );
    expect(within(strip).queryByText('Sample')).toBeNull();
    expect(status.textContent).not.toMatch(DEMO_COPY);
  });
});

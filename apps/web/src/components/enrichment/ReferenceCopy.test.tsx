// No provider key: the account page still shows fixture firmographics, hiring,
// and projects. sample stays true. The chip and the status line say reference
// records, and they do not say Sample, illustrative, or live.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ status: 'not_configured' }));

vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<typeof import('@/lib/api')>()),
  api: vi.fn(async () => ({
    companyId: 'acct-1',
    status: state.status,
    stale: false,
    providers: {},
    provenance: {},
  })),
}));
vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: () => true }));

import { FirmographicsStrip } from './FirmographicsStrip';
import { HiringNowCard } from './HiringNowCard';
import { PotentialProjectsCard } from './PotentialProjectsCard';

const DEMO_COPY = /\bsample\b|\billustrative\b|\blive\b/i;
const NOT_CONFIGURED =
  'Company enrichment is not configured (no provider key), so these are reference records.';
const NOT_ENRICHED = 'This account has not been enriched yet, so these are reference records.';

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  state.status = 'not_configured';
});

describe('enrichment fixture copy on the account page', () => {
  it('labels unset enrichment as reference records and keeps the provider-key fact', async () => {
    wrap(<FirmographicsStrip companyId="acct-1" />);
    const strip = await screen.findByTestId('account-firmographics');
    const status = within(strip).getByRole('status');

    expect(status.textContent).toContain(NOT_CONFIGURED);
    expect(within(strip).getByText('Reference').getAttribute('title')).toBe(
      'Reference records until company enrichment is connected',
    );
    expect(within(strip).queryByText('Sample')).toBeNull();
    expect(status.textContent).not.toMatch(DEMO_COPY);
    // No provider is configured, so there is nothing to refresh.
    expect(within(strip).queryByTestId('enrichment-refresh')).toBeNull();
  });

  it('says reference records when the account has not been enriched yet', async () => {
    state.status = 'not_enriched';
    wrap(<FirmographicsStrip companyId="acct-1" />);
    const strip = await screen.findByTestId('account-firmographics');
    const status = within(strip).getByRole('status');

    expect(status.textContent).toContain(NOT_ENRICHED);
    expect(within(strip).getByText('Reference')).toBeTruthy();
    expect(within(strip).queryByText('Sample')).toBeNull();
    expect(status.textContent).not.toMatch(DEMO_COPY);
    expect(within(strip).getByTestId('enrichment-refresh').textContent).toBe('Enrich now');
  });

  it('uses the same Reference chip on hiring and potential projects', async () => {
    wrap(
      <>
        <HiringNowCard companyId="acct-1" />
        <PotentialProjectsCard companyId="acct-1" />
      </>,
    );
    const hiring = await screen.findByTestId('account-hiring-now');
    const projects = await screen.findByTestId('account-potential-projects');

    expect(within(hiring).getByText('Reference')).toBeTruthy();
    expect(within(projects).getByText('Reference')).toBeTruthy();
    expect(within(hiring).queryByText('Sample')).toBeNull();
    expect(within(projects).queryByText('Sample')).toBeNull();
  });
});

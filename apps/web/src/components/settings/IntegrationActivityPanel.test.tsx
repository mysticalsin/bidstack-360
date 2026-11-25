// The integrations activity line sits above the connector tabs for an admin.
// On a demo workspace the health read is mostly open feeds, unset keys, and
// rows that were never probed. Calling that "4 of 8 providers healthy" reads
// as an outage. An empty read must not keep saying it is loading, and it must
// not mount the rail: that rail paints ERP and External CRM as healthy when
// it is given no rows.
import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProviderHealth } from '@bidstack/shared';

import { IntegrationActivityPanel } from './IntegrationActivityPanel';

type Phase = 'settled' | 'loading' | 'error' | 'empty' | 'down' | 'degraded';

const harness = vi.hoisted(() => ({
  phase: 'settled' as Phase,
  dashboardCalls: 0,
  healthCalls: 0,
  refetch: vi.fn(),
}));

function row(provider: string, status: ProviderHealth['status']): ProviderHealth {
  return {
    provider,
    status,
    latencyMs: null,
    lastCheckedAt: '2026-11-25T12:00:00.000Z',
    message: null,
  };
}

// The demo catalog without paid keys: four open feeds, two unset credentials,
// two rows that are configuration rather than a live probe.
const DEMO_HEALTH: ProviderHealth[] = [
  row('SEC EDGAR', 'healthy'),
  row('USAspending', 'healthy'),
  row('Wikidata + Wikimedia Commons', 'healthy'),
  row('TradingView Widgets', 'healthy'),
  row('Apollo Organizations', 'disabled'),
  row('SAM.gov', 'disabled'),
  row('Dust REST', 'unverified'),
  row('External CRM GraphQL', 'unverified'),
];

function healthResult() {
  harness.healthCalls += 1;
  const refetch = harness.refetch;
  if (harness.phase === 'loading') {
    return { data: undefined, isLoading: true, isError: false, isSuccess: false, refetch };
  }
  if (harness.phase === 'error') {
    return { data: undefined, isLoading: false, isError: true, isSuccess: false, refetch };
  }
  if (harness.phase === 'empty') {
    return { data: { items: [] }, isLoading: false, isError: false, isSuccess: true, refetch };
  }
  const items =
    harness.phase === 'down'
      ? [...DEMO_HEALTH, row('Slack', 'down')]
      : harness.phase === 'degraded'
        ? [...DEMO_HEALTH, row('Sillage Buying Signals', 'degraded')]
        : DEMO_HEALTH;
  return { data: { items }, isLoading: false, isError: false, isSuccess: true, refetch };
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/hooks/useCrmDashboard', () => ({
  useCrmDashboard: () => {
    harness.dashboardCalls += 1;
    const providerHealth =
      harness.phase === 'settled'
        ? DEMO_HEALTH
        : harness.phase === 'down'
          ? [...DEMO_HEALTH, row('Slack', 'down')]
          : [];
    return {
      data: harness.phase === 'loading' || harness.phase === 'error' ? undefined : { providerHealth },
      isLoading: harness.phase === 'loading',
      isError: harness.phase === 'error',
    };
  },
}));

vi.mock('@/hooks/useCrmIntegrations', () => ({
  useProviderHealth: () => healthResult(),
}));

vi.mock('@/hooks/useAccountSignals', () => ({
  usePortfolioMomentum: () => ({
    data: {
      accounts: [{ companyId: 'co-northwind', companyName: 'Northwind Energy' }],
      accountsContinue: false,
    },
    isLoading: false,
  }),
  useAccountPulse: () => ({
    isLoading: false,
    isError: false,
    data: { companyName: 'Northwind Energy', sources: [] },
  }),
}));

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<IntegrationActivityPanel />, { wrapper: Wrapper });
}

beforeEach(() => {
  harness.phase = 'settled';
  harness.dashboardCalls = 0;
  harness.healthCalls = 0;
  harness.refetch.mockReset();
});

afterEach(() => cleanup());

describe('integrations activity health line', () => {
  it('names open, unset, and unprobed connectors instead of an outage ratio', () => {
    // WHY: a demo admin opening Integrations sees this line first. Four open
    // feeds plus unset keys is not "4 of 8 providers healthy". The line also
    // must not load the workspace dashboard to say it — that snapshot is the
    // cockpit, not this strip.
    renderPanel();

    expect(screen.getByText('4 healthy, 2 not set up, 2 not a live probe')).toBeTruthy();
    expect(screen.queryByText(/of \d+ providers healthy/)).toBeNull();
    expect(screen.queryByText('Provider health loading')).toBeNull();
    expect(harness.dashboardCalls).toBe(0);
    expect(harness.healthCalls).toBeGreaterThan(0);
  });

  it('keeps a down connector in the line without folding the unset ones into it', () => {
    harness.phase = 'down';
    renderPanel();

    expect(
      screen.getByText('1 down, 4 healthy, 2 not set up, 2 not a live probe'),
    ).toBeTruthy();
    expect(screen.queryByText(/of \d+ providers healthy/)).toBeNull();
  });

  it('names a degraded connector on its own, still apart from unset keys', () => {
    harness.phase = 'degraded';
    renderPanel();

    expect(
      screen.getByText('1 degraded, 4 healthy, 2 not set up, 2 not a live probe'),
    ).toBeTruthy();
    expect(screen.queryByText(/of \d+ providers healthy/)).toBeNull();
  });

  it('says the health read is still checking and does not invent a healthy ERP', () => {
    // WHY: the rail's empty list is four healthy placeholders (ERP, External
    // CRM, External Intelligence, Market data). Passing it no rows while the
    // read is open shows a healthy stack that the demo workspace does not have.
    harness.phase = 'loading';
    renderPanel();

    expect(screen.getByText('Checking provider health')).toBeTruthy();
    expect(screen.queryByText('Provider health loading')).toBeNull();
    expect(screen.queryByText('ERP')).toBeNull();
    expect(screen.queryByText('ERP, External CRM, verified data connectors')).toBeNull();
  });

  it('says the health read failed and offers a retry, instead of staying on loading', () => {
    harness.phase = 'error';
    renderPanel();

    expect(screen.getByText('Could not load provider health')).toBeTruthy();
    expect(screen.queryByText('Provider health loading')).toBeNull();
    expect(screen.queryByText('ERP')).toBeNull();
    screen.getByRole('button', { name: 'Retry' }).click();
    expect(harness.refetch).toHaveBeenCalledTimes(1);
  });

  it('says a settled empty read has no provider health and does not invent one', () => {
    harness.phase = 'empty';
    renderPanel();

    expect(screen.getByText('No provider health in this read')).toBeTruthy();
    expect(screen.queryByText('Provider health loading')).toBeNull();
    expect(screen.queryByText('ERP')).toBeNull();
  });
});

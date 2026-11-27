import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ useProviderHealth: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/hooks/useCrmIntegrations', () => ({
  useProviderHealth: m.useProviderHealth,
  useTestProviderHealth: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { ProviderHealthSection } from './ProviderHealthSection';

const CRM = {
  provider: 'External CRM GraphQL',
  status: 'healthy' as const,
  latencyMs: 42,
  lastCheckedAt: '2026-11-25T12:00:00.000Z',
  message: 'Core CRM adapter online',
};

function health(state: { isLoading?: boolean; isError?: boolean; items?: Array<typeof CRM> }) {
  m.useProviderHealth.mockReturnValue({
    data: state.items ? { items: state.items } : undefined,
    isLoading: state.isLoading ?? false,
    isFetching: state.isLoading ?? false,
    isError: state.isError ?? false,
    error: state.isError ? new Error('provider health down') : null,
    refetch: vi.fn(),
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ProviderHealthSection', () => {
  it('does not call a failed provider read an empty stable book', () => {
    // WHY: Integrations, Provider health is where a demo admin checks External
    // CRM GraphQL and the open feeds. A failed read has no rows. The caption
    // still said no providers were configured, and the badge still said stable.
    health({ isError: true });
    render(<ProviderHealthSection />);

    expect(screen.queryByText('No providers configured yet.')).toBeNull();
    expect(screen.queryByText('stable')).toBeNull();
    expect(screen.getByText('Provider health is not loaded.')).toBeTruthy();
    expect(screen.getByText('not loaded')).toBeTruthy();
    expect(screen.getByText('Could not load provider health')).toBeTruthy();
  });

  it('keeps a loaded empty list empty', () => {
    // WHY: a settled read with no providers is an empty book. That copy stays.
    health({ items: [] });
    render(<ProviderHealthSection />);

    expect(screen.getByText('No providers configured yet.')).toBeTruthy();
    expect(screen.getByText('No providers wired yet')).toBeTruthy();
    expect(screen.getByText('stable')).toBeTruthy();
    expect(screen.queryByText('Could not load provider health')).toBeNull();
  });

  it('keeps a loaded provider', () => {
    // WHY: the demo catalog still names External CRM GraphQL when the read lands.
    health({ items: [CRM] });
    render(<ProviderHealthSection />);

    expect(screen.getByText('External CRM GraphQL')).toBeTruthy();
    expect(screen.getByText('Core CRM adapter online')).toBeTruthy();
    expect(screen.getByText('stable')).toBeTruthy();
    expect(screen.queryByText('No providers configured yet.')).toBeNull();
  });
});

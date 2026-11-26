// The connectors catalog is the integrations page's source list. A read that
// has not arrived has no rows. That gap is not an empty category, and a failed
// read is not a healthy count of zero sources. A settled empty catalog stays
// empty. A connector that arrived stays on the list.
import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CrmConnector } from '@bidstack/shared';

type FetchStatus = 'idle' | 'paused' | 'fetching';

const catalog = vi.hoisted(() => ({
  data: undefined as { items: CrmConnector[] } | undefined,
  isLoading: false,
  isPending: false,
  isError: false,
  fetchStatus: 'idle' as FetchStatus,
  error: null as Error | null,
  refetch: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values[key] ?? ''));
    },
  }),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: () => false,
}));

vi.mock('@/hooks/useCrmIntegrations', () => ({
  useConnectorCatalog: () => catalog,
  useUserIntegrationsStatus: () => ({ data: { integrations: [] } }),
}));

vi.mock('@/lib/api', () => ({ api: vi.fn() }));

import { ConnectorsSection } from './ConnectorsSection';

const EMPTY_TITLE = 'No connectors in this category';
const ZERO_SOURCES = '0 sources';
const CHECKING = 'Checking connectors';
const NOT_ARRIVED = 'The catalog has not arrived.';
const LOAD_ERROR = 'Could not load connectors';

const samGov: CrmConnector = {
  id: 'sam-gov',
  name: 'SAM.gov',
  kind: 'open_api',
  category: 'procurement',
  status: 'healthy',
  requiresCredential: false,
  sourceUrl: 'https://example.test/sam',
  docsUrl: 'https://example.test/sam/docs',
  lastCheckedAt: '2026-01-01T00:00:00.000Z',
  message: null,
  capabilities: [],
};

function renderCatalog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<ConnectorsSection />, { wrapper: Wrapper });
}

function unreadCatalog(fetchStatus: FetchStatus) {
  catalog.data = undefined;
  catalog.isLoading = fetchStatus === 'fetching';
  catalog.isPending = true;
  catalog.isError = false;
  catalog.fetchStatus = fetchStatus;
  catalog.error = null;
}

afterEach(() => {
  cleanup();
  catalog.refetch.mockReset();
});

describe('Connectors catalog read', () => {
  it('does not call a paused catalog an empty category', () => {
    unreadCatalog('paused');
    renderCatalog();

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.getByText(NOT_ARRIVED)).toBeTruthy();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
    expect(screen.queryByText(ZERO_SOURCES)).toBeNull();
  });

  it('does not count an in-flight catalog as zero sources', () => {
    unreadCatalog('fetching');
    renderCatalog();

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.getByText(NOT_ARRIVED)).toBeTruthy();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
    expect(screen.queryByText(ZERO_SOURCES)).toBeNull();
  });

  it('does not count a failed catalog as zero sources', () => {
    catalog.data = undefined;
    catalog.isLoading = false;
    catalog.isPending = false;
    catalog.isError = true;
    catalog.fetchStatus = 'idle';
    catalog.error = new Error('catalog down');
    renderCatalog();

    expect(screen.getByText(LOAD_ERROR)).toBeTruthy();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
    expect(screen.queryByText(ZERO_SOURCES)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('keeps a settled empty catalog empty', () => {
    catalog.data = { items: [] };
    catalog.isLoading = false;
    catalog.isPending = false;
    catalog.isError = false;
    catalog.fetchStatus = 'idle';
    catalog.error = null;
    renderCatalog();

    expect(screen.getByText(EMPTY_TITLE)).toBeTruthy();
    expect(screen.getByText(ZERO_SOURCES)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(NOT_ARRIVED)).toBeNull();
  });

  it('keeps a connector that has arrived', () => {
    catalog.data = { items: [samGov] };
    catalog.isLoading = false;
    catalog.isPending = false;
    catalog.isError = false;
    catalog.fetchStatus = 'idle';
    catalog.error = null;
    renderCatalog();

    expect(screen.getByText('SAM.gov')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
    expect(screen.queryByText(ZERO_SOURCES)).toBeNull();
  });
});

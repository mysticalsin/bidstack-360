// Slack's disconnect tears down the org's ONE shared workspace connection
// (server-gated behind integrations:write — see apps/api/src/routes/integrations/slack.ts).
// Gmail/Microsoft mail disconnect only ever touch the caller's own mailbox and
// must stay open regardless of permission. This locks that asymmetry in place.
import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorsSection } from './ConnectorsSection';
import type { CrmConnector } from '@bidstack/shared';
import type { UserIntegrationStatus } from '@/hooks/useCrmIntegrations';

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<ConnectorsSection />, { wrapper: Wrapper });
}

const hookMocks = vi.hoisted(() => ({
  canWriteIntegrations: false,
  integrations: [] as UserIntegrationStatus[],
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
  useHasPermission: () => hookMocks.canWriteIntegrations,
}));

vi.mock('@/hooks/useCrmIntegrations', () => ({
  useConnectorCatalog: () => ({
    data: { items: connectors },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useUserIntegrationsStatus: () => ({ data: { integrations: hookMocks.integrations } }),
}));

vi.mock('@/lib/api', () => ({ api: vi.fn() }));

const baseConnector = {
  kind: 'official_widget' as const,
  status: 'healthy' as const,
  requiresCredential: false,
  sourceUrl: 'https://example.com',
  docsUrl: 'https://example.com/docs',
  lastCheckedAt: '2026-01-01T00:00:00.000Z',
  message: null,
  capabilities: [],
};

const connectors: CrmConnector[] = [
  { ...baseConnector, id: 'slack', name: 'Slack', category: 'ai' },
  { ...baseConnector, id: 'gmail', name: 'Gmail', category: 'people' },
];

beforeEach(() => {
  hookMocks.canWriteIntegrations = false;
  hookMocks.integrations = [
    { provider: 'slack', status: 'CONNECTED', connectedEmail: null, lastSyncedAt: null, errorMessage: null, scopes: [] },
    { provider: 'gmail', status: 'CONNECTED', connectedEmail: 'rep@mantu.com', lastSyncedAt: null, errorMessage: null, scopes: [] },
  ];
});

afterEach(() => cleanup());

describe('ConnectorsSection — Slack disconnect RBAC gate', () => {
  it('disables Slack disconnect for a user without integrations:write, with a hint', () => {
    hookMocks.canWriteIntegrations = false;
    renderSection();

    const slackRow = screen.getByTestId('integration-card-slack');
    const disconnectButton = within(slackRow).getByRole('button', { name: /disconnect/i });

    expect(disconnectButton.hasAttribute('disabled')).toBe(true);
    expect(disconnectButton.getAttribute('title')).toMatch(/integrations write access/i);
    expect(disconnectButton.getAttribute('aria-label')).toMatch(/integrations write access/i);
  });

  it('enables Slack disconnect for a user holding integrations:write', () => {
    hookMocks.canWriteIntegrations = true;
    renderSection();

    const slackRow = screen.getByTestId('integration-card-slack');
    const disconnectButton = within(slackRow).getByRole('button', { name: /disconnect/i });

    expect(disconnectButton.hasAttribute('disabled')).toBe(false);
  });

  it('never gates Gmail disconnect — it only ever touches the caller\'s own mailbox', () => {
    hookMocks.canWriteIntegrations = false;
    renderSection();

    const gmailRow = screen.getByTestId('integration-card-gmail');
    const disconnectButton = within(gmailRow).getByRole('button', { name: /disconnect/i });

    expect(disconnectButton.hasAttribute('disabled')).toBe(false);
  });
});

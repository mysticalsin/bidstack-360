// Slack's disconnect tears down the org's ONE shared workspace connection
// (server-gated behind integrations:write — see apps/api/src/routes/integrations/slack.ts).
// Gmail/Microsoft mail disconnect only ever touch the caller's own mailbox and
// must stay open regardless of permission. This locks that asymmetry in place.
import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
  connectors: [] as CrmConnector[],
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
    data: { items: hookMocks.connectors },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useUserIntegrationsStatus: () => ({ data: { integrations: hookMocks.integrations } }),
}));

const apiMocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMocks.api }));

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

const disconnectedSlack: UserIntegrationStatus = {
  provider: 'slack',
  status: 'DISCONNECTED',
  connectedEmail: null,
  lastSyncedAt: null,
  errorMessage: null,
  scopes: [],
};

beforeEach(() => {
  hookMocks.canWriteIntegrations = false;
  hookMocks.connectors = connectors;
  hookMocks.integrations = [
    { provider: 'slack', status: 'CONNECTED', connectedEmail: null, lastSyncedAt: null, errorMessage: null, scopes: [] },
    { provider: 'gmail', status: 'CONNECTED', connectedEmail: 'rep@example.test', lastSyncedAt: null, errorMessage: null, scopes: [] },
  ];
  apiMocks.api.mockReset();
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

  it('leaves Gmail to the workspace accounts card instead of a second catalog row', () => {
    renderSection();

    expect(screen.queryByTestId('integration-card-gmail')).toBeNull();
    expect(screen.getByTestId('integration-card-slack')).toBeTruthy();
  });
});

// A demo workspace has no Slack app and no linked workspace. The status read
// still returns Slack as DISCONNECTED, and the catalog says the app is
// disabled. Connect must not look like it can start, and a credential on the
// server must not be described as this workspace already being connected.
describe('ConnectorsSection — Slack connect under demo data', () => {
  it('does not start a connect when the Slack app is not set up', () => {
    hookMocks.canWriteIntegrations = true;
    hookMocks.integrations = [disconnectedSlack];
    hookMocks.connectors = [
      {
        ...baseConnector,
        id: 'slack',
        name: 'Slack',
        category: 'people',
        kind: 'credentialed_api',
        status: 'disabled',
        requiresCredential: true,
        message: 'Connect Slack workspace for DMs and alerts. (SLACK_CLIENT_ID not set)',
      },
    ];
    renderSection();

    const slackRow = screen.getByTestId('integration-card-slack');
    const connectButton = within(slackRow).getByRole('button', { name: /connect/i });

    expect(connectButton.hasAttribute('disabled')).toBe(true);
    expect(connectButton.getAttribute('title')).toMatch(/add the Slack app first/i);
    expect(within(slackRow).getByText('Not set up')).toBeTruthy();
    expect(within(slackRow).queryByText(/healthy/i)).toBeNull();
    expect(within(slackRow).queryByText(/Slack connection active/i)).toBeNull();
    expect(within(slackRow).queryByText(/SLACK_CLIENT_ID/)).toBeNull();

    fireEvent.click(connectButton);
    expect(apiMocks.api).not.toHaveBeenCalled();
  });

  it('does not call a configured app a connected workspace when this user has not connected', () => {
    hookMocks.canWriteIntegrations = true;
    hookMocks.integrations = [disconnectedSlack];
    hookMocks.connectors = [
      {
        ...baseConnector,
        id: 'slack',
        name: 'Slack',
        category: 'people',
        kind: 'credentialed_api',
        status: 'healthy',
        requiresCredential: true,
        message: 'Slack connection active.',
      },
    ];
    renderSection();

    const slackRow = screen.getByTestId('integration-card-slack');
    const connectButton = within(slackRow).getByRole('button', { name: /^connect$/i });

    expect(within(slackRow).getByText('Not connected')).toBeTruthy();
    expect(within(slackRow).queryByText('Slack connection active.')).toBeNull();
    expect(within(slackRow).queryByText(/^healthy$/i)).toBeNull();
    expect(within(slackRow).queryByText(/^disabled$/i)).toBeNull();
    expect(connectButton.hasAttribute('disabled')).toBe(false);
    // The catalog calls the app healthy because a server credential exists.
    // This workspace is not linked, so the section total must not count it.
    expect(screen.getByText('Healthy').closest('div')?.parentElement?.textContent).toContain('0');
  });

  it('does not start a connect without integrations write access', () => {
    hookMocks.canWriteIntegrations = false;
    hookMocks.integrations = [disconnectedSlack];
    hookMocks.connectors = [
      {
        ...baseConnector,
        id: 'slack',
        name: 'Slack',
        category: 'people',
        kind: 'credentialed_api',
        status: 'healthy',
        requiresCredential: true,
        message: 'Slack connection active.',
      },
    ];
    renderSection();

    const connectButton = within(screen.getByTestId('integration-card-slack')).getByRole('button', {
      name: /connect/i,
    });
    expect(connectButton.hasAttribute('disabled')).toBe(true);
    expect(connectButton.getAttribute('title')).toMatch(/integrations write access/i);
    fireEvent.click(connectButton);
    expect(apiMocks.api).not.toHaveBeenCalled();
  });

  it('says the connect did not start when the server returns no consent URL', async () => {
    hookMocks.canWriteIntegrations = true;
    hookMocks.integrations = [disconnectedSlack];
    hookMocks.connectors = [
      {
        ...baseConnector,
        id: 'slack',
        name: 'Slack',
        category: 'people',
        kind: 'credentialed_api',
        status: 'healthy',
        requiresCredential: true,
        message: 'Slack connection active.',
      },
    ];
    apiMocks.api.mockResolvedValue({ authUrl: '' });
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, assign },
    });
    renderSection();

    fireEvent.click(within(screen.getByTestId('integration-card-slack')).getByRole('button', { name: /^connect$/i }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/could not start the slack connection/i);
    expect(assign).not.toHaveBeenCalled();
  });
});

// A paused or in-flight provider-key read has no rows yet. The card used the
// same "No provider list returned" line as a settled empty list, or only the
// loading skeleton. The keys have not arrived, so that empty is not a finding.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { useAgentProviderCredentials } from '@/hooks/useAgentProviderCredentials';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
  }),
}));

vi.mock('@/lib/auth', () => ({
  useIsAdmin: () => true,
}));

vi.mock('@/hooks/useAgentProviderCredentials', () => ({
  useAgentProviderCredentials: vi.fn(),
  useSaveAgentProviderCredential: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveAgentProviderCredential: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetActiveAgentProvider: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTestAgentProvider: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/components/ui/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { useAgentProviderCredentials } from '@/hooks/useAgentProviderCredentials';
import { AgentProviderCredentialsCard } from './AgentProviderCredentialsCard';

const CHECKING = 'Checking model providers. The list has not arrived.';
const EMPTY = 'No provider list returned';
const FAILED = 'Could not load provider keys';
const PROVIDER = 'OpenAI';

type CredentialsQuery = ReturnType<typeof useAgentProviderCredentials>;

function credentialsQuery(partial: Partial<CredentialsQuery>): CredentialsQuery {
  return {
    refetch: vi.fn(),
    error: null,
    ...partial,
  } as CredentialsQuery;
}

function renderCard(credentials: CredentialsQuery) {
  vi.mocked(useAgentProviderCredentials).mockReturnValue(credentials);
  return render(<AgentProviderCredentialsCard />);
}

function expectNoSettledEmpty() {
  expect(screen.queryByText(EMPTY)).toBeNull();
  expect(screen.queryByText(PROVIDER)).toBeNull();
  expect(screen.queryByText(FAILED)).toBeNull();
}

const LOADED = {
  provider: 'openai' as const,
  configured: true,
  source: 'org' as const,
  model: 'gpt-4o-mini',
  baseUrl: null,
  apiKeyMasked: 'sk-abcd',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('AgentProviderCredentialsCard unread keys', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(useAgentProviderCredentials).mockReset();
  });

  it('does not call a paused provider-key read an empty list', async () => {
    // WHY: a paused first read has isLoading false and no payload. The card
    // said No provider list returned, while the keys have not arrived.
    renderCard(
      credentialsQuery({
        data: undefined,
        isError: false,
        isLoading: false,
        status: 'pending',
        fetchStatus: 'paused',
      }),
    );

    expect(await screen.findByText(CHECKING)).toBeTruthy();
    expectNoSettledEmpty();
  });

  it('does not call an in-flight provider-key read an empty list', async () => {
    // WHY: a slow read showed only the loading skeleton. A list that has not
    // arrived is not a catalog the API returned empty.
    renderCard(
      credentialsQuery({
        data: undefined,
        isError: false,
        isLoading: true,
        status: 'pending',
        fetchStatus: 'fetching',
      }),
    );

    expect(await screen.findByText(CHECKING)).toBeTruthy();
    expectNoSettledEmpty();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('does not call a failed provider-key read an empty list', async () => {
    // WHY: a failed read is not evidence that the API returned no providers.
    // The error stays, and the card does not say the list is empty.
    renderCard(
      credentialsQuery({
        data: undefined,
        isError: true,
        isLoading: false,
        status: 'error',
        fetchStatus: 'idle',
        error: new Error('offline'),
      }),
    );

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(PROVIDER)).toBeNull();
  });

  it('still shows a settled list that returned no providers', async () => {
    // WHY: a list that arrived with no rows is empty. That sentence stays,
    // so a real empty catalog is not dressed up as a slow network.
    renderCard(
      credentialsQuery({
        data: { items: [], active: null },
        isError: false,
        isLoading: false,
        status: 'success',
        fetchStatus: 'idle',
      }),
    );

    expect(await screen.findByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(PROVIDER)).toBeNull();
  });

  it('still shows a provider that has arrived', async () => {
    // WHY: a loaded provider stays on the card. The unread line must not
    // replace a key the read already returned.
    renderCard(
      credentialsQuery({
        data: { items: [LOADED], active: 'openai' },
        isError: false,
        isLoading: false,
        status: 'success',
        fetchStatus: 'idle',
      }),
    );

    expect(await screen.findByRole('heading', { name: PROVIDER })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

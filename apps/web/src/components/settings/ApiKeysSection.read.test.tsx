// A paused, in-flight, or failed API-key read has no list yet. Developer
// access used the same "No API keys yet" line as a settled empty list, and
// an in-flight read showed only a blank shimmer. That payload has not
// arrived, so empty is not a finding.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { useApiKeys } from '@/hooks/useApiKeys';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
  }),
}));

vi.mock('@/hooks/useApiKeys', () => ({
  useApiKeys: vi.fn(),
  useCreateApiKey: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRevokeApiKey: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { useApiKeys as useApiKeysMock } from '@/hooks/useApiKeys';
import { ApiKeysSection } from './ApiKeysSection';

const UNREAD = 'Checking API keys. The payload has not arrived.';
const EMPTY = 'No API keys yet';
const EMPTY_MESSAGE = 'Create one to let Dust, your MCP client, or a CI job authenticate.';
const FAILED = 'API keys did not load.';
const KEY_NAME = 'ci-job';

type KeysQuery = ReturnType<typeof useApiKeys>;

function keysQuery(partial: Partial<KeysQuery>): KeysQuery {
  return {
    refetch: vi.fn(),
    error: null,
    ...partial,
  } as KeysQuery;
}

function renderSection(keys: KeysQuery) {
  vi.mocked(useApiKeysMock).mockReturnValue(keys);
  return render(<ApiKeysSection />);
}

function expectNoSettledEmpty() {
  expect(screen.queryByText(EMPTY)).toBeNull();
  expect(screen.queryByText(EMPTY_MESSAGE)).toBeNull();
  expect(screen.queryByText(KEY_NAME)).toBeNull();
}

const LOADED_KEY = {
  id: '11111111-1111-4111-8111-111111111111',
  name: KEY_NAME,
  prefix: 'bsk_test',
  scopes: ['read'],
  readOnly: true,
  unrestrictedScope: false,
  companyIds: [],
  msaIds: [],
  lastUsedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('ApiKeysSection unread list', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(useApiKeysMock).mockReset();
  });

  it('does not call a paused API key read an empty list', async () => {
    // WHY: a paused first read has isLoading false and no payload. Developer
    // access said No API keys yet while the payload has not arrived.
    renderSection(
      keysQuery({
        data: undefined,
        isError: false,
        isLoading: false,
        status: 'pending',
        fetchStatus: 'paused',
      }),
    );

    expect(await screen.findByText(UNREAD)).toBeTruthy();
    expectNoSettledEmpty();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('does not call an in-flight API key read an empty list', async () => {
    // WHY: a slow read showed only a blank shimmer. A payload that has not
    // arrived is not a workspace with no API keys.
    renderSection(
      keysQuery({
        data: undefined,
        isError: false,
        isLoading: true,
        status: 'pending',
        fetchStatus: 'fetching',
      }),
    );

    expect(await screen.findByText(UNREAD)).toBeTruthy();
    expectNoSettledEmpty();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('does not call a failed API key read an empty list', async () => {
    // WHY: a failed read is not evidence that the workspace has no keys.
    // status error with isError still false used to fall through to No API
    // keys yet. The failure says the list did not load, and it does not say empty.
    renderSection(
      keysQuery({
        data: undefined,
        isError: false,
        isLoading: false,
        status: 'error',
        fetchStatus: 'idle',
        error: new Error('offline'),
      }),
    );

    expect(await screen.findByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(UNREAD)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(EMPTY_MESSAGE)).toBeNull();
    expect(screen.queryByText(KEY_NAME)).toBeNull();
  });

  it('still shows a settled list that has no API keys', async () => {
    // WHY: a list that arrived with no keys is empty. That sentence stays,
    // so a real empty catalog is not dressed up as a slow network.
    renderSection(
      keysQuery({
        data: { items: [], pageContinues: false },
        isError: false,
        isLoading: false,
        status: 'success',
        fetchStatus: 'idle',
      }),
    );

    expect(await screen.findByText(EMPTY)).toBeTruthy();
    expect(screen.getByText(EMPTY_MESSAGE)).toBeTruthy();
    expect(screen.queryByText(UNREAD)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('still shows a key that has arrived', async () => {
    // WHY: a loaded key stays on the list. The unread line must not replace
    // a key the read already returned.
    renderSection(
      keysQuery({
        data: { items: [LOADED_KEY], pageContinues: false },
        isError: false,
        isLoading: false,
        status: 'success',
        fetchStatus: 'idle',
      }),
    );

    expect(await screen.findByText(KEY_NAME)).toBeTruthy();
    expect(screen.queryByText(UNREAD)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(EMPTY_MESSAGE)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });
});

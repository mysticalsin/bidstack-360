// WHY: Settings opens the Dust credentials card before the saved record
// returns. An unread record has no workspace. The card still said Dust
// isn't connected yet and offered Connect Dust, which is what a loaded
// unconfigured record says. An unread record and a saved unconfigured
// record are different. Connect would write a key over a page the screen
// never showed.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  useDustCredentials: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock('@/lib/auth', () => ({
  useIsAdmin: () => true,
}));

vi.mock('@/hooks/useDustCredentials', () => ({
  useDustCredentials: hookMocks.useDustCredentials,
  useSaveDustCredentials: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveDustCredentials: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/components/ui/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/components/ui/ConfirmDialog', () => ({
  confirm: vi.fn(),
}));

import { DustCredentialsCard } from './DustCredentialsCard';

const UNCONNECTED = "Dust isn't connected yet";
const ADD_KEY =
  'Add your Dust API key and workspace ID to turn on AI drafting, compliance and crew agents.';

function credentialRecord(overrides: Record<string, unknown> = {}) {
  return {
    configured: false,
    source: null,
    workspaceId: null,
    baseUrl: null,
    dataSourceId: null,
    agentIds: {},
    apiKeyMasked: null,
    ...overrides,
  };
}

function mockCredentials(state: {
  data?: unknown;
  isPending: boolean;
  isLoading: boolean;
  isError: boolean;
  refetch?: ReturnType<typeof vi.fn>;
}) {
  hookMocks.useDustCredentials.mockReturnValue({
    data: state.data,
    isPending: state.isPending,
    isLoading: state.isLoading,
    isFetching: state.isLoading,
    isError: state.isError,
    error: state.isError ? new Error('credentials unavailable') : null,
    refetch: state.refetch ?? vi.fn(),
  });
}

describe('Dust credentials unread record', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not present a credential load that has not arrived as an unconnected workspace', () => {
    mockCredentials({
      data: undefined,
      isLoading: false,
      isPending: true,
      isError: false,
    });

    render(<DustCredentialsCard />);

    expect(screen.getByText('Checking Dust credentials.')).toBeTruthy();
    expect(screen.queryByText(UNCONNECTED)).toBeNull();
    expect(screen.queryByText(ADD_KEY)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Connect Dust' })).toBeNull();
    expect(screen.queryByText('Could not load Dust credentials')).toBeNull();
  });

  it('does not offer Connect Dust when the credential read fails', () => {
    const refetch = vi.fn();
    mockCredentials({
      data: undefined,
      isLoading: false,
      isPending: false,
      isError: true,
      refetch,
    });

    render(<DustCredentialsCard />);

    expect(screen.getByText('Could not load Dust credentials')).toBeTruthy();
    expect(screen.getByText('The saved credentials have not arrived.')).toBeTruthy();
    expect(screen.queryByText(UNCONNECTED)).toBeNull();
    expect(screen.queryByText(ADD_KEY)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Connect Dust' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('still says Dust is not connected once a saved unconfigured record has loaded', () => {
    mockCredentials({
      data: credentialRecord(),
      isLoading: false,
      isPending: false,
      isError: false,
    });

    render(<DustCredentialsCard />);

    expect(screen.getByText(UNCONNECTED)).toBeTruthy();
    expect(screen.getByText(ADD_KEY)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect Dust' })).toBeTruthy();
    expect(screen.queryByText('Checking Dust credentials.')).toBeNull();
    expect(screen.queryByText('Could not load Dust credentials')).toBeNull();
    expect(screen.queryByText('The saved credentials have not arrived.')).toBeNull();
  });

  it('still shows a saved org workspace once the credential record has loaded', () => {
    mockCredentials({
      data: credentialRecord({
        configured: true,
        source: 'org',
        workspaceId: 'w-example',
        apiKeyMasked: 'abcd',
      }),
      isLoading: false,
      isPending: false,
      isError: false,
    });

    render(<DustCredentialsCard />);

    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.getByText('w-example')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Update keys' })).toBeTruthy();
    expect(screen.queryByText(UNCONNECTED)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Connect Dust' })).toBeNull();
    expect(screen.queryByText('Checking Dust credentials.')).toBeNull();
    expect(screen.queryByText('Could not load Dust credentials')).toBeNull();
  });

  it('still offers Connect Dust when the loaded record is only the platform default', () => {
    mockCredentials({
      data: credentialRecord({
        configured: true,
        source: 'env',
        workspaceId: 'w-platform',
      }),
      isLoading: false,
      isPending: false,
      isError: false,
    });

    render(<DustCredentialsCard />);

    expect(screen.getByText('Platform default')).toBeTruthy();
    expect(screen.getByText('w-platform')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect Dust' })).toBeTruthy();
    expect(screen.queryByText(UNCONNECTED)).toBeNull();
    expect(screen.queryByText('Checking Dust credentials.')).toBeNull();
    expect(screen.queryByText('Could not load Dust credentials')).toBeNull();
  });
});

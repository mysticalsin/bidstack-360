import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  refetch: vi.fn(),
  useApiKeys: vi.fn(),
  useCreateApiKey: vi.fn(),
  useRevokeApiKey: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/hooks/useApiKeys', () => ({
  useApiKeys: hookMocks.useApiKeys,
  useCreateApiKey: hookMocks.useCreateApiKey,
  useRevokeApiKey: hookMocks.useRevokeApiKey,
}));

vi.mock('@/components/ui/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/components/ui/ConfirmDialog', () => ({
  confirm: vi.fn(),
}));

import { ApiKeysSection } from './ApiKeysSection';

describe('ApiKeysSection', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('surfaces API key load failures instead of rendering the empty state', () => {
    hookMocks.useApiKeys.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Requires permission: settings:read'),
      refetch: hookMocks.refetch,
    });
    hookMocks.useCreateApiKey.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    hookMocks.useRevokeApiKey.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });

    render(<ApiKeysSection />);

    expect(screen.getByText("Couldn't load API keys")).toBeTruthy();
    expect(screen.getByText('Requires permission: settings:read')).toBeTruthy();
    expect(screen.queryByText('No API keys yet')).toBeNull();
  });

  it('defaults the MCP transport and MCP read scope checkboxes to unchecked in the create-key dialog', () => {
    // WHY this matters: defaultChecked previously ticked both boxes, silently
    // granting broad MCP transport + read access even when the user only
    // selected granular REST scopes — every new key was over-scoped by default.
    hookMocks.useApiKeys.mockReturnValue({
      data: { items: [] },
      isLoading: false,
      isError: false,
      error: null,
      refetch: hookMocks.refetch,
    });
    hookMocks.useCreateApiKey.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    hookMocks.useRevokeApiKey.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });

    render(<ApiKeysSection />);
    fireEvent.click(screen.getByRole('button', { name: '+ New API key' }));

    const mcpTransport = screen.getByRole('checkbox', {
      name: /^MCP transport/,
    }) as HTMLInputElement;
    const mcpRead = screen.getByRole('checkbox', { name: /^MCP read tools/ }) as HTMLInputElement;
    expect(mcpTransport.checked).toBe(false);
    expect(mcpRead.checked).toBe(false);
  });
});

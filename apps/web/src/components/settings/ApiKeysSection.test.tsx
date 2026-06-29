import { cleanup, render, screen } from '@testing-library/react';
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
});

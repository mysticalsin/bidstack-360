import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  refetch: vi.fn(),
  useApiKeys: vi.fn(),
  useCreateApiKey: vi.fn(),
  useRevokeApiKey: vi.fn(),
}));

const writeText = vi.hoisted(() => vi.fn());

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

const SECRET = 'bidstack_demo_secret';

function createdKey(secret: string) {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'demo-mcp',
    prefix: 'bidstack_dem',
    scopes: ['mcp'],
    readOnly: true,
    unrestrictedScope: false,
    companyIds: [],
    msaIds: [],
    lastUsedAt: null,
    createdAt: '2026-01-15T00:00:00.000Z',
    secret,
  };
}

async function createKey(secret: string) {
  const mutateAsync = vi.fn().mockResolvedValue(createdKey(secret));
  hookMocks.useApiKeys.mockReturnValue({
    data: { items: [], pageContinues: false },
    isLoading: false,
    isError: false,
    error: null,
    refetch: hookMocks.refetch,
  });
  hookMocks.useCreateApiKey.mockReturnValue({ mutateAsync, isPending: false });
  hookMocks.useRevokeApiKey.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });

  render(<ApiKeysSection />);
  fireEvent.click(screen.getByRole('button', { name: '+ New API key' }));
  fireEvent.change(screen.getByPlaceholderText('e.g. dust-prod, mcp-cli'), {
    target: { value: 'demo-mcp' },
  });
  fireEvent.click(screen.getByRole('checkbox', { name: /^MCP transport/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Create key' }));
  expect(await screen.findByText(/Copy your new key now/)).toBeTruthy();
  return mutateAsync;
}

describe('API key one-shot copy', () => {
  beforeEach(() => {
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not report a copy when the new key secret is empty', async () => {
    // WHY: the secret is shown once. Writing an empty string and saying
    // Copied would send a demo admin away with a blank key.
    await createKey('   ');

    const copy = screen.queryByRole('button', { name: 'Copy' });
    if (copy) fireEvent.click(copy);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Copied!' })).toBeNull();
      expect(writeText).not.toHaveBeenCalled();
    });
    expect(screen.getByRole('alert').textContent).toMatch(/empty/i);
  });

  it('says the copy failed when the clipboard rejects a real secret', async () => {
    // WHY: a denied clipboard used to leave Copy looking idle. The secret
    // is not in a field, so the demo admin cannot select it either.
    writeText.mockRejectedValue(new Error('Clipboard unavailable'));
    await createKey(SECRET);

    const field = screen.getByRole('textbox', { name: 'API key secret' }) as HTMLInputElement;
    expect(field.value).toBe(SECRET);
    expect(field.readOnly).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringMatching(/Copy failed/),
    );
    expect(screen.queryByRole('button', { name: 'Copied!' })).toBeNull();
    expect(writeText).toHaveBeenCalledWith(SECRET);
  });

  it('copies a real secret and says so', async () => {
    // WHY: the happy path still has to write the secret the server returned,
    // unchanged, and the button has to say that it landed.
    await createKey(SECRET);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('button', { name: 'Copied!' })).toBeTruthy();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(SECRET);
  });
});

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  refetch: vi.fn(),
  mutateAsync: vi.fn(),
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

import { toast } from '@/components/ui/Toast';
import { ApiKeysSection } from './ApiKeysSection';

const SYNTHETIC_SECRET = 'bidstack_demo_synthetic_key';

const SYNTHETIC_KEY = {
  id: 'demo-synthetic-key',
  name: 'Demo synthetic',
  prefix: 'bidstack_dem',
  scopes: ['contacts:read'],
  readOnly: true,
  unrestrictedScope: false,
  companyIds: [] as string[],
  msaIds: [] as string[],
  lastUsedAt: null,
  createdAt: '2026-11-25T15:00:00.000Z',
};

function listQuery(overrides: Record<string, unknown>) {
  hookMocks.useApiKeys.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: hookMocks.refetch,
    ...overrides,
  });
}

async function createSyntheticKey(secret: string) {
  hookMocks.mutateAsync.mockResolvedValue({ ...SYNTHETIC_KEY, secret });
  render(<ApiKeysSection />);
  fireEvent.click(screen.getByRole('button', { name: '+ New API key' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
    target: { value: 'Demo synthetic' },
  });
  fireEvent.click(screen.getByRole('checkbox', { name: 'contacts:read' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create key' }));
}

describe('API key empty state and copy', () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    hookMocks.useCreateApiKey.mockReturnValue({
      mutateAsync: hookMocks.mutateAsync,
      isPending: false,
    });
    hookMocks.useRevokeApiKey.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('names a loading key list and does not call it empty', () => {
    // WHY: a demo key list still in flight is not an empty keyring and not a
    // settled miss. The loading state has to stay distinct from both.
    listQuery({ isLoading: true });

    render(<ApiKeysSection />);

    expect(screen.queryByText('No API keys yet')).toBeNull();
    expect(screen.queryByText('API keys are not loaded')).toBeNull();
  });

  it('says keys are not loaded when the query settles with no payload', () => {
    // WHY: a settled query with no payload used the empty-keyring copy. On
    // demo that tells the user they have no keys when the list never arrived.
    listQuery({ data: undefined, isLoading: false, isError: false });

    render(<ApiKeysSection />);

    expect(screen.getByText('API keys are not loaded')).toBeTruthy();
    expect(screen.queryByText('No API keys yet')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(hookMocks.refetch).toHaveBeenCalled();
  });

  it('keeps the empty keyring copy when the list really is empty', () => {
    // WHY: a payload of zero keys is the empty state. It must not be replaced
    // by the not-loaded message.
    listQuery({ data: { items: [] } });

    render(<ApiKeysSection />);

    expect(screen.getByText('No API keys yet')).toBeTruthy();
    expect(screen.queryByText('API keys are not loaded')).toBeNull();
  });

  it('lists a synthetic demo key by prefix and does not print the secret', () => {
    // WHY: the settings list is not a second reveal. Demo data may include a
    // synthetic key, and the full secret must not be on the page to copy.
    listQuery({
      data: {
        items: [{ ...SYNTHETIC_KEY, secret: SYNTHETIC_SECRET }],
      },
    });

    render(<ApiKeysSection />);

    expect(screen.getByText('Demo synthetic')).toBeTruthy();
    expect(screen.getByText(/bidstack_dem/)).toBeTruthy();
    expect(screen.queryByText(SYNTHETIC_SECRET)).toBeNull();
  });

  it('copies the synthetic secret exactly once', async () => {
    // WHY: Copy is the only way to keep a new key. It must write that secret
    // and no other string.
    listQuery({ data: { items: [] } });

    await createSyntheticKey(SYNTHETIC_SECRET);
    expect(await screen.findByText(/Copy your new key now/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect(await screen.findByRole('button', { name: 'Copied!' })).toBeTruthy();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(SYNTHETIC_SECRET);
    expect(toast.success).toHaveBeenCalled();
  });

  it('does not say the secret was copied when the clipboard rejects it', async () => {
    // WHY: a denied clipboard used to fail silently. The secret is shown once,
    // so a failed copy must stay visible and must not read as Copied.
    writeText.mockRejectedValue(new Error('clipboard denied'));
    listQuery({ data: { items: [] } });

    await createSyntheticKey(SYNTHETIC_SECRET);
    expect(await screen.findByRole('button', { name: 'Copy' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect(await screen.findByText('Copy failed. The secret is still on screen.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copied!' })).toBeNull();
    expect(screen.getByText(SYNTHETIC_SECRET)).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith(SYNTHETIC_SECRET);
  });

  it.each(['', '   '])(
    'does not copy a blank secret (%j)',
    async (secret) => {
      // WHY: an empty create payload is not a key. Copy must not write a blank
      // string and must not say the secret was copied.
      listQuery({ data: { items: [] } });

      await createSyntheticKey(secret);

      expect(await screen.findByText('This key has no secret to copy.')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Copied!' })).toBeNull();
      expect(writeText).not.toHaveBeenCalled();
      expect(toast.success).not.toHaveBeenCalled();
    },
  );
});

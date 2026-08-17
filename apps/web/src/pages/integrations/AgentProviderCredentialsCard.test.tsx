// Regression coverage: OmniRoute is a keyless local AI gateway (default
// http://localhost:20128/v1, model "auto") and must be selectable/saveable
// without an API key, exactly like the existing keyless Gemma provider. If a
// future edit reintroduces a blanket "API key required" guard, or drops
// OmniRoute from the provider list / from the front of it, these tests fail.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentProviderCredentialsCard } from './AgentProviderCredentialsCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values[key] ?? ''));
    },
  }),
}));

vi.mock('@/lib/auth', () => ({
  useIsAdmin: () => true,
}));

const saveMutateAsync = vi.fn().mockResolvedValue(undefined);

vi.mock('@/hooks/useAgentProviderCredentials', () => ({
  useAgentProviderCredentials: () => ({
    data: { items: [], active: null },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useSaveAgentProviderCredential: () => ({ mutateAsync: saveMutateAsync, isPending: false }),
  useRemoveAgentProviderCredential: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetActiveAgentProvider: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTestAgentProvider: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/components/ui/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

afterEach(() => {
  cleanup();
  saveMutateAsync.mockClear();
});

describe('AgentProviderCredentialsCard — OmniRoute', () => {
  it('lists OmniRoute first in the provider dropdown', () => {
    render(<AgentProviderCredentialsCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Add provider' }));

    const options = screen.getAllByRole('option') as HTMLOptionElement[];
    expect(options[0]!.value).toBe('omniroute');
    expect(options[0]!.textContent).toContain('OmniRoute');
  });

  it('saves an OmniRoute credential with no API key and no model typed', async () => {
    render(<AgentProviderCredentialsCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Add provider' }));

    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'omniroute' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save provider' }));

    await vi.waitFor(() => expect(saveMutateAsync).toHaveBeenCalled());
    expect(saveMutateAsync).toHaveBeenCalledWith({
      provider: 'omniroute',
      apiKey: undefined,
      model: undefined,
      baseUrl: undefined,
    });
    // No "API key is required" (or any) validation error blocked the save.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the keyless hint under the API key field when OmniRoute is selected', () => {
    render(<AgentProviderCredentialsCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Add provider' }));

    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'omniroute' } });

    expect(
      screen.getByText('Free local AI gateway — no key needed. Routes across many free providers with auto-fallback.'),
    ).toBeTruthy();
  });
});

describe('AgentProviderCredentialsCard — Cloudflare Workers AI', () => {
  // Regression: the provider list used to be a bare array with a
  // `?? PROVIDERS[0]` fallback, so a provider the API served but the UI did not
  // know rendered as a SECOND card labelled "OmniRoute (free gateway)".
  it('offers Cloudflare in the dropdown under its own label', () => {
    render(<AgentProviderCredentialsCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Add provider' }));

    const options = screen.getAllByRole('option') as HTMLOptionElement[];
    const cf = options.find((o) => o.value === 'cloudflare');
    expect(cf).toBeTruthy();
    expect(cf!.textContent).toContain('Cloudflare Workers AI');
  });

  it('asks for an account ID, not a base URL, and offers a model picker', () => {
    render(<AgentProviderCredentialsCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Add provider' }));
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'cloudflare' } });

    expect(screen.getByLabelText(/Cloudflare account ID/)).toBeTruthy();
    // The model field is a <select> for Cloudflare — the @cf/ ids are long and
    // the context window is what decides whether a long extraction fits.
    const modelField = screen.getByLabelText(/^Model/) as HTMLSelectElement;
    expect(modelField.tagName).toBe('SELECT');
    expect(Array.from(modelField.options).some((o) => o.value.startsWith('@cf/'))).toBe(true);
    expect(modelField.options[0]!.textContent).toMatch(/\d+k context/);
  });

  it('blocks a save with a malformed account ID before any request', () => {
    // Without an account id the composed base URL is empty and every AI call
    // fails with "Failed to parse URL" deep inside a background job.
    render(<AgentProviderCredentialsCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Add provider' }));
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'cloudflare' } });
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'cf-token' } });
    fireEvent.change(screen.getByLabelText(/Cloudflare account ID/), {
      target: { value: 'nope' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save provider' }));

    expect(screen.getByRole('alert').textContent).toContain('not a Cloudflare account ID');
    expect(saveMutateAsync).not.toHaveBeenCalled();
  });

  it('saves the account ID and chosen model when both are valid', async () => {
    render(<AgentProviderCredentialsCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Add provider' }));
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'cloudflare' } });
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'cf-token' } });
    fireEvent.change(screen.getByLabelText(/Cloudflare account ID/), {
      target: { value: '0123456789abcdef0123456789abcdef' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save provider' }));

    await vi.waitFor(() => expect(saveMutateAsync).toHaveBeenCalled());
    expect(saveMutateAsync).toHaveBeenCalledWith({
      provider: 'cloudflare',
      apiKey: 'cf-token',
      model: '@cf/zai-org/glm-4.7-flash',
      baseUrl: '0123456789abcdef0123456789abcdef',
    });
  });
});

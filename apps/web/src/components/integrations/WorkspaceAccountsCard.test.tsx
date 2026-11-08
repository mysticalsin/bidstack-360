import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceAccountsCard, WORKSPACE_CONSENT_COPY } from './WorkspaceAccountsCard';

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  confirm: vi.fn(async () => true),
  assign: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      values ? fallback.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(values[k] ?? '')) : fallback,
  }),
}));
vi.mock('@/lib/api', () => ({ api: mocks.api }));
vi.mock('@/components/ui/ConfirmDialog', () => ({ confirm: mocks.confirm }));

const connectedGoogle = {
  provider: 'google',
  configured: true,
  status: 'connected',
  accountEmail: 'rep@mantu.com',
  scopes: [
    { key: 'identity', label: 'See your email address', access: 'read' },
    { key: 'mail_read', label: 'Read your email', access: 'read' },
    { key: 'calendar_read', label: 'Read your calendar', access: 'read' },
  ],
  lastSyncedAt: '2026-11-06T14:00:00.000Z',
  connectedAt: '2026-11-01T14:00:00.000Z',
  errorMessage: null,
};
const unconfiguredMicrosoft = {
  provider: 'microsoft',
  configured: false,
  status: 'disconnected',
  accountEmail: null,
  scopes: [],
  lastSyncedAt: null,
  connectedAt: null,
  errorMessage: null,
};

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<WorkspaceAccountsCard />, { wrapper: Wrapper });
}

beforeEach(() => {
  mocks.api.mockReset();
  mocks.confirm.mockClear();
  mocks.assign.mockReset();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, assign: mocks.assign },
  });
  mocks.api.mockImplementation(async (path: string) => {
    if (path === '/api/integrations/workspace') return { providers: [connectedGoogle, unconfiguredMicrosoft] };
    if (path === '/api/integrations/workspace/google/connect') return { authUrl: 'https://accounts.example/consent' };
    return null;
  });
});
afterEach(() => cleanup());

describe('WorkspaceAccountsCard', () => {
  it('pins the read-only consent line', async () => {
    renderCard();
    expect(WORKSPACE_CONSENT_COPY).toBe('Read-only. Polo never sends mail or changes your calendar.');
    expect(await screen.findByText(WORKSPACE_CONSENT_COPY)).toBeTruthy();
  });

  it('shows status, account, plain-word scopes and last sync for a connected account', async () => {
    renderCard();
    const card = await screen.findByTestId('integration-card-gmail');
    expect(within(card).getByText('Connected')).toBeTruthy();
    expect(within(card).getByText('rep@mantu.com')).toBeTruthy();
    expect(within(card).getByText('Read your email')).toBeTruthy();
    expect(within(card).getByText('Read your calendar')).toBeTruthy();
    expect(within(card).getByText(/Last sync/)).toBeTruthy();
    expect(within(card).getByRole('button', { name: /reconnect/i })).toBeTruthy();
  });

  it('never gates disconnect: it only touches the caller\'s own mailbox', async () => {
    renderCard();
    const card = await screen.findByTestId('integration-card-gmail');
    const button = within(card).getByRole('button', { name: /disconnect/i });
    expect(button.hasAttribute('disabled')).toBe(false);
    fireEvent.click(button);
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith('/api/integrations/workspace/google', { method: 'DELETE' }),
    );
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
  });

  it('sends the user to the provider consent page on reconnect', async () => {
    renderCard();
    const card = await screen.findByTestId('integration-card-gmail');
    fireEvent.click(within(card).getByRole('button', { name: /reconnect/i }));
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith('https://accounts.example/consent'));
    expect(mocks.api).toHaveBeenCalledWith('/api/integrations/workspace/google/connect', { method: 'POST' });
  });

  it('says plainly when a provider is not set up on this server', async () => {
    renderCard();
    const card = await screen.findByTestId('integration-card-microsoft');
    expect(within(card).getByText('Not set up')).toBeTruthy();
    expect(within(card).getByRole('button', { name: /connect/i }).hasAttribute('disabled')).toBe(true);
  });

  it('asks to reconnect when access was revoked', async () => {
    mocks.api.mockImplementation(async () => ({
      providers: [
        { ...connectedGoogle, status: 'revoked', errorMessage: 'Access was revoked. Reconnect to resume sync.' },
        unconfiguredMicrosoft,
      ],
    }));
    renderCard();
    const card = await screen.findByTestId('integration-card-gmail');
    expect(within(card).getByText('Access revoked')).toBeTruthy();
    expect(within(card).getByText('Access was revoked. Reconnect to resume sync.')).toBeTruthy();
  });

  it('surfaces a failed disconnect instead of silently re-enabling the button', async () => {
    mocks.api.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === '/api/integrations/workspace') return { providers: [connectedGoogle, unconfiguredMicrosoft] };
      if (init?.method === 'DELETE') throw new Error('boom');
      return null;
    });
    renderCard();
    const card = await screen.findByTestId('integration-card-gmail');
    fireEvent.click(within(card).getByRole('button', { name: /disconnect/i }));
    expect((await within(card).findByRole('alert')).textContent).toBe(
      'Could not disconnect. Access is still active. Try again.',
    );
  });

  it('surfaces a failed reconnect', async () => {
    mocks.api.mockImplementation(async (path: string) => {
      if (path === '/api/integrations/workspace') return { providers: [connectedGoogle, unconfiguredMicrosoft] };
      throw new Error('boom');
    });
    renderCard();
    const card = await screen.findByTestId('integration-card-gmail');
    fireEvent.click(within(card).getByRole('button', { name: /reconnect/i }));
    expect((await within(card).findByRole('alert')).textContent).toBe('Could not start the connection. Try again.');
    expect(mocks.assign).not.toHaveBeenCalled();
  });

  it('shows a retry when the status cannot load', async () => {
    mocks.api.mockRejectedValue(new Error('boom'));
    renderCard();
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});

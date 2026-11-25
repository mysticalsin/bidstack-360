import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

import { ContactsPanel } from './ContactsPanel';

const OPP = '/api/opportunities/opp-1/contacts';

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ContactsPanel oppId="opp-1" />
    </QueryClientProvider>,
  );
}

function directory(path: string) {
  if (path === '/api/contacts') return Promise.resolve({ items: [], nextCursor: null });
  return Promise.reject(new Error(`unhandled ${path}`));
}

describe('ContactsPanel — a failed linked-contact read is not an empty deal', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
  });

  it('holds a failed read as an error with retry, not as no linked contacts', async () => {
    // WHY: a CRM outage used to render "No linked contacts" and "0 contacts".
    // That reads as an empty buying committee. The deal still has contacts;
    // the read failed. Retry is the way back to the list.
    apiMock.mockImplementation((path: string) => {
      if (path === OPP) return Promise.reject(new Error('contacts unavailable'));
      return directory(path);
    });

    renderPanel();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("Couldn't load linked contacts");
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByText('No linked contacts')).toBeNull();
    expect(screen.queryByText('0 contacts')).toBeNull();
  });

  it('does not call the deal empty while the linked-contact read is still loading', async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === OPP) return new Promise(() => undefined);
      return directory(path);
    });

    renderPanel();

    await waitFor(() => {
      expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
    });
    expect(screen.queryByText('No linked contacts')).toBeNull();
    expect(screen.queryByText('0 contacts')).toBeNull();
  });

  it('retries the read and shows the linked contact once the read succeeds', async () => {
    let failed = false;
    apiMock.mockImplementation((path: string) => {
      if (path === OPP) {
        if (!failed) {
          failed = true;
          return Promise.reject(new Error('contacts unavailable'));
        }
        return Promise.resolve({
          items: [
            {
              id: 'link-1',
              contactId: '11111111-1111-4111-8111-111111111111',
              role: 'champion',
              isPrimary: false,
              contact: { name: 'Avery Chen', email: 'avery.chen@example.com' },
            },
          ],
        });
      }
      return directory(path);
    });

    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Avery Chen')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('No linked contacts')).toBeNull();
  });

  it('keeps the empty state when the read succeeds and the deal has no linked contacts', async () => {
    // WHY: a real empty buying committee is still "No linked contacts".
    // Only a failed read must leave that state.
    apiMock.mockImplementation((path: string) => {
      if (path === OPP) return Promise.resolve({ items: [] });
      return directory(path);
    });

    renderPanel();

    expect(await screen.findByText('No linked contacts')).toBeTruthy();
    expect(screen.getByText('0 contacts')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});

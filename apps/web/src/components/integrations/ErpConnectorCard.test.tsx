import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: mocks.api,
}));

import { ApiError } from '@/lib/api';
import { ErpConnectorCard } from './ErpConnectorCard';

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<ErpConnectorCard />, { wrapper: Wrapper });
}

afterEach(() => {
  cleanup();
  mocks.api.mockReset();
});

describe('ErpConnectorCard', () => {
  it('stays hidden and quiet when this deployment has no ERP routes', async () => {
    mocks.api.mockRejectedValue(new ApiError('Not Found', 404, null));
    const { container } = renderCard();
    await waitFor(() => expect(mocks.api).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(mocks.api.mock.calls.map(([p]) => String(p))).toEqual(['/api/integrations/erp/status']);
    expect(container.textContent).toBe('');
  });

  it('does not offer a live partner lookup when ERP is not configured', async () => {
    // WHY: demo leaves ERP_ENABLED off. Status answers "not configured", but
    // the card still mounted a kit and a partner lookup stuck on "checking",
    // with the field already filled with a real company name. Check could
    // only hit a route this deployment does not register.
    mocks.api.mockImplementation((path: string) => {
      if (String(path).includes('/erp/status')) {
        return Promise.resolve({
          configured: false,
          url: null,
          database: null,
          reachable: false,
          toolCount: null,
          lastError: null,
        });
      }
      return Promise.reject(new ApiError('Not Found', 404, null));
    });

    renderCard();

    await waitFor(() => expect(screen.getByText('not configured')).toBeTruthy());

    expect(screen.queryByDisplayValue('Mantu')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Check' })).toBeNull();
    expect(screen.queryByText('checking')).toBeNull();
    expect(screen.queryByText('ERP bid operating kit')).toBeNull();
    expect(screen.queryByText('local')).toBeNull();
    expect(screen.getByText(/Set/)).toBeTruthy();
    expect(mocks.api.mock.calls.map(([p]) => String(p))).toEqual(['/api/integrations/erp/status']);
  });

  it('does not search a company until someone types one', async () => {
    // WHY: a configured card used to open on a real company name and call
    // autocomplete immediately. The lookup stays idle until there is a query.
    mocks.api.mockImplementation((path: string) => {
      const url = String(path);
      if (url.includes('/erp/status')) {
        return Promise.resolve({
          configured: true,
          url: 'https://erp.example.test',
          database: 'presales',
          reachable: true,
          toolCount: 2,
          lastError: null,
        });
      }
      if (url.includes('/presales-kit')) {
        return Promise.resolve({
          generatedAt: '2026-11-25T12:00:00.000Z',
          configured: true,
          reachable: true,
          modules: [],
          partnerAutocomplete: { inputs: [], fallback: '', validates: [] },
          fieldMap: [],
          nextActions: [],
          lastError: null,
        });
      }
      return Promise.resolve({
        generatedAt: '2026-11-25T12:00:00.000Z',
        configured: true,
        reachable: true,
        source: 'none',
        items: [],
        warnings: [],
      });
    });

    renderCard();

    const check = await screen.findByRole('button', { name: 'Check' });
    expect(check.hasAttribute('disabled')).toBe(true);
    expect(screen.queryByDisplayValue('Mantu')).toBeNull();
    expect((screen.getByRole('textbox', { name: 'Company autocomplete query' }) as HTMLInputElement).value).toBe('');
    expect(screen.getByText('not searched')).toBeTruthy();
    expect(screen.queryByText('checking')).toBeNull();
    const urls = mocks.api.mock.calls.map(([p]) => String(p));
    expect(urls.some((url) => url.toLowerCase().includes('mantu'))).toBe(false);
    expect(urls.some((url) => url.includes('company-autocomplete'))).toBe(false);
    expect(screen.getByText('Type a company name, domain, VAT, or DUNS, then check.')).toBeTruthy();
  });

  it('checks the synthetic name someone typed', async () => {
    // WHY: the lookup still has to run once there is a name. Idle must not
    // mean the control is dead.
    mocks.api.mockImplementation((path: string) => {
      const url = String(path);
      if (url.includes('/erp/status')) {
        return Promise.resolve({
          configured: true,
          url: 'https://erp.example.test',
          database: 'presales',
          reachable: true,
          toolCount: 2,
          lastError: null,
        });
      }
      if (url.includes('/presales-kit')) {
        return Promise.resolve({
          generatedAt: '2026-11-25T12:00:00.000Z',
          configured: true,
          reachable: true,
          modules: [],
          partnerAutocomplete: { inputs: [], fallback: '', validates: [] },
          fieldMap: [],
          nextActions: [],
          lastError: null,
        });
      }
      return Promise.resolve({
        generatedAt: '2026-11-25T12:00:00.000Z',
        configured: true,
        reachable: true,
        source: 'none',
        items: [],
        warnings: [],
      });
    });

    renderCard();
    const input = await screen.findByRole('textbox', { name: 'Company autocomplete query' });
    fireEvent.change(input, { target: { value: 'Northwind Energy' } });

    await waitFor(() => {
      const urls = mocks.api.mock.calls.map(([p]) => String(p));
      expect(urls.some((url) => url.includes('company-autocomplete') && url.includes('Northwind'))).toBe(
        true,
      );
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Check' }).hasAttribute('disabled')).toBe(false);
    });
    expect(
      mocks.api.mock.calls.map(([p]) => String(p)).some((url) => url.toLowerCase().includes('mantu')),
    ).toBe(false);
  });
});

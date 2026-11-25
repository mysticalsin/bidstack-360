// Regression: manual-override cell edits, "New Forecast", and per-row delete
// all persist through POST/PATCH/DELETE /api/forecasts, gated server-side
// behind territories:write (apps/api/src/routes/territories-forecast.ts:63,146)
// — before this test existed every write affordance rendered unconditionally,
// a 403-on-click trap for a role (e.g. Presales) that holds territories:read
// but not territories:write.
import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) => {
      if (!opts) return fallback;
      return Object.entries(opts).reduce(
        (str, [k, v]) => str.replace(`{{${k}}}`, String(v)),
        fallback,
      );
    },
    i18n: { language: 'en' },
  }),
}));

const capabilitiesMocks = vi.hoisted(() => ({ useHasPermission: vi.fn(() => true) }));
vi.mock('@/hooks/useCapabilities', () => capabilitiesMocks);

const forecast = {
  id: 'f-1',
  orgId: 'org-1',
  ownerId: 'owner-1',
  ownerName: 'Alice Dev',
  period: '2026-08',
  category: 'commit' as const,
  amountMicros: 5_000_000,
  currency: 'EUR',
  note: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const forecastsMocks = vi.hoisted(() => ({
  useForecastProjection: vi.fn(() => ({ data: undefined, isLoading: false, isError: false })),
  useForecasts: vi.fn(),
  useCreateForecast: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useDeleteForecast: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
}));
vi.mock('@/hooks/useForecasts', () => forecastsMocks);

const usersMocks = vi.hoisted(() => ({ useUsers: vi.fn(() => ({ data: [] })) }));
vi.mock('@/hooks/useUsers', () => usersMocks);

import { ForecastsPage } from './ForecastsPage';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<ForecastsPage />, { wrapper: Wrapper });
}

describe('ForecastsPage — territories:write gating', () => {
  beforeEach(() => {
    forecastsMocks.useForecasts.mockReturnValue({
      data: { items: [forecast] },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows New Forecast and enables cell edit / row delete for a user with territories:write', () => {
    capabilitiesMocks.useHasPermission.mockReturnValue(true);

    renderPage();

    expect(screen.getByRole('button', { name: /New Forecast/i })).toBeTruthy();
    const editButtons = screen.getAllByRole('button', { name: /^Edit .+ for 2026-08$/ });
    expect(editButtons.length).toBeGreaterThan(0);
    editButtons.forEach((btn) => expect((btn as HTMLButtonElement).disabled).toBe(false));
    const deleteButtons = screen.getAllByRole('button', { name: /Delete forecasts for 2026-08/i });
    expect(deleteButtons.length).toBeGreaterThan(0);
    deleteButtons.forEach((btn) => expect((btn as HTMLButtonElement).disabled).toBe(false));
  });

  it('hides New Forecast and disables cell edit / row delete for a user without territories:write', () => {
    capabilitiesMocks.useHasPermission.mockReturnValue(false);

    renderPage();

    // Read access still shows the data (desktop table + mobile card render it twice)...
    expect(screen.getAllByText('Alice Dev').length).toBeGreaterThan(0);
    // ...but every write affordance is gone or disabled, not just visually hidden.
    expect(screen.queryByRole('button', { name: /New Forecast/i })).toBeNull();
    const hint = 'You need territories write access to edit forecasts.';
    const editButtons = screen.getAllByRole('button', { name: /^Edit .+ for 2026-08/ });
    expect(editButtons.length).toBeGreaterThan(0);
    editButtons.forEach((btn) => {
      expect((btn as HTMLButtonElement).disabled).toBe(true);
      expect(btn.getAttribute('title')).toBe(hint);
      // `title` is mouse-only — the accessible name itself must carry the
      // reason so screen-reader/keyboard users get it too.
      expect(btn.getAttribute('aria-label')).toMatch(new RegExp(`— ${hint}$`));
    });
    const deleteButtons = screen.getAllByRole('button', { name: /Delete forecasts for 2026-08/i });
    expect(deleteButtons.length).toBeGreaterThan(0);
    deleteButtons.forEach((btn) => {
      expect((btn as HTMLButtonElement).disabled).toBe(true);
      expect(btn.getAttribute('aria-label')).toMatch(new RegExp(`— ${hint}$`));
    });
  });
});

describe('ForecastsPage — period label the projection prints', () => {
  const mutateAsync = vi.fn(async () => ({ id: 'created' }));

  beforeEach(() => {
    capabilitiesMocks.useHasPermission.mockReturnValue(true);
    forecastsMocks.useForecasts.mockReturnValue({
      data: { items: [] },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    forecastsMocks.useCreateForecast.mockReturnValue({
      mutate: vi.fn(),
      mutateAsync,
      isPending: false,
    });
    usersMocks.useUsers.mockReturnValue({
      data: [{ id: 'owner-1', name: 'Alex Example', email: 'alex.example@example.test' }],
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('keeps a quarter copied from the projection on the Quarterly tab', () => {
    // WHY: the chart says "Q1 2027". That string matches no period filter, so
    // the row is saved and then missing from Monthly, Quarterly, and Yearly.
    forecastsMocks.useForecasts.mockReturnValue({
      data: {
        items: [{ ...forecast, period: 'Q1 2027' }],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.queryByText('Alice Dev')).toBeNull();
    // Radix tabs select on mouse down.
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Quarterly' }));
    expect(screen.getAllByText('Alice Dev').length).toBeGreaterThan(0);
  });

  it('stores the projection label as the quarterly key and opens that tab', async () => {
    // WHY: New Forecast accepts the label on the chart. Leaving the page on
    // Monthly after a quarterly save hides the row the rep just entered.
    renderPage();

    fireEvent.click(screen.getAllByRole('button', { name: /New Forecast/i })[0]!);
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'Q1 2027' } });
    fireEvent.click(screen.getByRole('combobox', { name: 'Owner' }));
    fireEvent.click(screen.getByRole('option', { name: 'Alex Example' }));
    fireEvent.change(screen.getByLabelText('Commit'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Forecast' }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ period: '2027-Q1', ownerId: 'owner-1', category: 'commit' }),
      );
    });
    expect(screen.getByRole('tab', { name: 'Quarterly' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Monthly' }).getAttribute('aria-selected')).toBe(
      'false',
    );
  });

  it('does not save a period that no filter can show', () => {
    // WHY: an owner and an amount are enough to save today. A period the
    // three filters all drop must stay on the form, not become a hidden row.
    renderPage();

    fireEvent.click(screen.getAllByRole('button', { name: /New Forecast/i })[0]!);
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'next quarter' } });
    fireEvent.click(screen.getByRole('combobox', { name: 'Owner' }));
    fireEvent.click(screen.getByRole('option', { name: 'Alex Example' }));
    fireEvent.change(screen.getByLabelText('Commit'), { target: { value: '5' } });

    expect(screen.getByRole('alert').textContent).toMatch(/Q1 2027/);
    expect((screen.getByRole('button', { name: 'Save Forecast' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});

// Regression: manual-override cell edits, "New Forecast", and per-row delete
// all persist through POST/PATCH/DELETE /api/forecasts, gated server-side
// behind territories:write (apps/api/src/routes/territories-forecast.ts:63,146)
// — before this test existed every write affordance rendered unconditionally,
// a 403-on-click trap for a role (e.g. Presales) that holds territories:read
// but not territories:write.
import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
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

describe('ForecastsPage — headline totals wait for a settled list', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not print a zero commit while the forecast list is still loading', () => {
    // WHY: the four tiles are the page's answer. An unloaded list is not a
    // zero commit, and a salesperson must not read one before the request ends.
    capabilitiesMocks.useHasPermission.mockReturnValue(true);
    forecastsMocks.useForecasts.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.queryByText('Commit')).toBeNull();
    expect(screen.getByRole('status', { name: /still loading/i })).toBeTruthy();
  });

  it('does not print a zero commit when the forecast list failed to load', () => {
    // WHY: a failed read sitting under four €0 tiles looks like a real forecast.
    // The tiles stay hidden and the existing list retry remains the way out.
    capabilitiesMocks.useHasPermission.mockReturnValue(true);
    forecastsMocks.useForecasts.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('forecasts down'),
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.queryByText('Commit')).toBeNull();
    expect(screen.getByRole('status', { name: /stay hidden/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('still shows a commit tile when the loaded list is empty', () => {
    // WHY: an empty override book is a real zero. Hiding it would make "no
    // manual forecasts" look the same as a request that has not answered.
    capabilitiesMocks.useHasPermission.mockReturnValue(true);
    forecastsMocks.useForecasts.mockReturnValue({
      data: { items: [] },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText('Commit')).toBeTruthy();
    expect(screen.queryByRole('status', { name: /still loading|stay hidden/i })).toBeNull();
  });
});

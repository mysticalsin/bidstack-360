import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  isAdmin: true,
}));

const hookMocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  useOrgLocaleSettings: vi.fn(),
  useUpdateOrgLocaleSettings: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/hooks/useOrgLocaleSettings', () => ({
  useOrgLocaleSettings: hookMocks.useOrgLocaleSettings,
  useUpdateOrgLocaleSettings: hookMocks.useUpdateOrgLocaleSettings,
}));

vi.mock('@/lib/auth', () => ({
  useIsAdmin: () => authMocks.isAdmin,
}));

vi.mock('@/components/ui/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { CurrencyLocaleSection } from './CurrencyLocaleSection';

describe('CurrencyLocaleSection', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    authMocks.isAdmin = true;
  });

  it('loads workspace defaults from the server and saves through the mutation hook', () => {
    hookMocks.useOrgLocaleSettings.mockReturnValue({
      data: { currency: 'CAD', dateFormat: 'YYYY-MM-DD', timezone: 'America/Toronto' },
      isError: false,
      isLoading: false,
    });
    hookMocks.useUpdateOrgLocaleSettings.mockReturnValue({
      isPending: false,
      mutate: hookMocks.mutate,
    });

    render(<CurrencyLocaleSection />);

    fireEvent.change(screen.getByLabelText('Default currency'), {
      target: { value: 'USD' },
    });
    fireEvent.change(screen.getByLabelText('Date format'), {
      target: { value: 'MM/DD/YYYY' },
    });
    fireEvent.change(screen.getByLabelText('Timezone'), {
      target: { value: 'America/New_York' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save currency and locale' }));

    expect(hookMocks.mutate).toHaveBeenCalledWith(
      {
        currency: 'USD',
        dateFormat: 'MM/DD/YYYY',
        timezone: 'America/New_York',
      },
      expect.objectContaining({
        onError: expect.any(Function),
        onSuccess: expect.any(Function),
      }),
    );
  });

  it('renders workspace defaults read-only for non-admin users', () => {
    authMocks.isAdmin = false;
    hookMocks.useOrgLocaleSettings.mockReturnValue({
      data: { currency: 'EUR', dateFormat: 'DD/MM/YYYY', timezone: 'Europe/Paris' },
      isError: false,
      isLoading: false,
    });
    hookMocks.useUpdateOrgLocaleSettings.mockReturnValue({
      isPending: false,
      mutate: hookMocks.mutate,
    });

    render(<CurrencyLocaleSection />);

    expect((screen.getByLabelText('Default currency') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('Date format') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('Timezone') as HTMLSelectElement).disabled).toBe(true);
    expect(
      screen.getByText('Workspace defaults are read-only unless you are an admin.'),
    ).toBeTruthy();
  });
});

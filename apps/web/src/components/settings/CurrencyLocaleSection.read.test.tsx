// A paused or in-flight currency locale read has no settings yet. The section
// said the load failed. That read has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
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
  useIsAdmin: () => true,
}));

vi.mock('@/components/ui/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { CurrencyLocaleSection } from './CurrencyLocaleSection';

const CHECKING = 'Checking currency and locale. The settings have not arrived.';
const FAILED = 'Could not load currency and locale';
const NONE = 'No currency and locale are saved.';

function locale(currency: string, dateFormat: string) {
  return {
    currency,
    dateFormat,
    timezone: 'Europe/Paris',
  };
}

function renderLocale(query: {
  data?: unknown;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  status?: string;
  error?: Error | null;
}) {
  hookMocks.useOrgLocaleSettings.mockReturnValue(query);
  hookMocks.useUpdateOrgLocaleSettings.mockReturnValue({
    isPending: false,
    mutate: vi.fn(),
  });
  render(<CurrencyLocaleSection />);
}

describe('CurrencyLocaleSection read', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it('does not treat a paused currency locale read as a failed load', () => {
    // WHY: a paused first read has isLoading false and no settings. Could not
    // load is the error. This read has not arrived.
    renderLocale({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'pending',
      error: null,
    });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText('Try again shortly.')).toBeNull();
    expect(screen.queryByLabelText('Default currency')).toBeNull();
    expect(screen.queryByText(NONE)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('does not treat an in-flight currency locale read as a failed load', () => {
    // WHY: a slow read also has no settings, and isLoading can stay false.
    // The load error must not stand in for a read that is still running.
    renderLocale({
      data: undefined,
      isLoading: false,
      isFetching: true,
      isError: false,
      status: 'pending',
      error: null,
    });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText('Try again shortly.')).toBeNull();
    expect(screen.queryByLabelText('Default currency')).toBeNull();
    expect(screen.queryByText(NONE)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('keeps a failed currency locale read on the error', () => {
    // WHY: a failed read is not an unread pause. Checking must not stand in
    // for the error.
    renderLocale({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      status: 'error',
      error: new Error('locale down'),
    });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.getByText('locale down')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(NONE)).toBeNull();
    expect(screen.queryByLabelText('Default currency')).toBeNull();
  });

  it('lets a failed read win over stale currency settings', () => {
    // WHY: error wins before a payload. A refetch failure must not keep the
    // form, and it must not store the stale currency.
    renderLocale({
      data: locale('CAD', 'YYYY-MM-DD'),
      isLoading: false,
      isFetching: false,
      isError: true,
      status: 'error',
      error: new Error('locale down'),
    });

    expect(screen.queryByLabelText('Default currency')).toBeNull();
    expect(screen.queryByLabelText('Date format')).toBeNull();
    expect(window.localStorage.getItem('bidstack:currency-locale')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(NONE)).toBeNull();
  });

  it('stays empty when a settled payload is null', () => {
    // WHY: null has arrived. Undefined data is unread. A null payload is not
    // a failed load.
    renderLocale({
      data: null,
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByText(NONE)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText('Try again shortly.')).toBeNull();
    expect(screen.queryByLabelText('Default currency')).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a loaded currency locale', () => {
    // WHY: a loaded payload stays. The unread line must not replace settings
    // the read already returned.
    renderLocale({
      data: locale('CAD', 'YYYY-MM-DD'),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect((screen.getByLabelText('Default currency') as HTMLSelectElement).value).toBe('CAD');
    expect((screen.getByLabelText('Date format') as HTMLSelectElement).value).toBe('YYYY-MM-DD');
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(NONE)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a loaded currency locale when the date format is blank', () => {
    // WHY: a blank date format is loaded data. Unread must not drop the
    // currency because a field is empty.
    renderLocale({
      data: locale('EUR', ''),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect((screen.getByLabelText('Default currency') as HTMLSelectElement).value).toBe('EUR');
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(NONE)).toBeNull();
  });
});

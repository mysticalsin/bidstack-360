// A paused or in-flight workspace currency read has no code yet. The sync
// rendered nothing, so the bar kept the default and looked ready. That read
// has not arrived, and silence is not a settled currency.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  query: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    status: 'pending' as string,
    dataUpdatedAt: 0,
  },
  apply: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
  }),
}));

vi.mock('@/hooks/useOrgLocaleSettings', () => ({
  useOrgLocaleSettings: () => hookMocks.query,
}));

vi.mock('@/stores/currency', () => ({
  useCurrencyStore: (selector: (state: { applyOrgCurrency: (code: string) => void }) => unknown) =>
    selector({ applyOrgCurrency: hookMocks.apply }),
}));

import { OrgCurrencySync } from './OrgCurrencySync';

const CHECKING = 'Checking the workspace currency. The currency has not arrived.';
const FAILED = 'Could not load the workspace currency.';

function renderSync() {
  return render(<OrgCurrencySync />);
}

function loaded(currency: unknown) {
  return {
    currency,
    dateFormat: 'YYYY-MM-DD',
    timezone: 'UTC',
  };
}

describe('OrgCurrencySync workspace currency read', () => {
  afterEach(() => {
    cleanup();
    hookMocks.apply.mockClear();
  });

  it('does not treat a paused currency read as ready', () => {
    // WHY: a paused first read has isLoading false and no payload. Rendering
    // nothing leaves the default currency looking ready. This read has not arrived.
    hookMocks.query = {
      data: undefined,
      isLoading: false,
      isError: false,
      status: 'pending',
      dataUpdatedAt: 0,
    };
    renderSync();

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    expect(hookMocks.apply).not.toHaveBeenCalled();
  });

  it('does not treat an in-flight currency read as ready', () => {
    // WHY: a slow read also has no payload. Silence is not a settled currency,
    // and it is not a failed load.
    hookMocks.query = {
      data: undefined,
      isLoading: true,
      isError: false,
      status: 'pending',
      dataUpdatedAt: 0,
    };
    renderSync();

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    expect(hookMocks.apply).not.toHaveBeenCalled();
  });

  it('keeps a failed currency read on the error', () => {
    // WHY: a failed read is not evidence that the default currency is ready.
    // The error stays, and silence does not stand in for the read.
    hookMocks.query = {
      data: undefined,
      isLoading: false,
      isError: true,
      status: 'error',
      dataUpdatedAt: 0,
    };
    renderSync();

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(hookMocks.apply).not.toHaveBeenCalled();
  });

  it('lets a failed read win over a stale currency', () => {
    // WHY: error wins before a payload. A refetch failure must not apply EUR
    // from a currency that is no longer the read.
    hookMocks.query = {
      data: loaded('EUR'),
      isLoading: false,
      isError: true,
      status: 'error',
      dataUpdatedAt: 5,
    };
    renderSync();

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(hookMocks.apply).not.toHaveBeenCalled();
  });

  it('lets a failed status win when isError is still false', () => {
    // WHY: a status of error is a failed read even if isError has not flipped.
    // A stale code must not be applied.
    hookMocks.query = {
      data: loaded('EUR'),
      isLoading: false,
      isError: false,
      status: 'error',
      dataUpdatedAt: 5,
    };
    renderSync();

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(hookMocks.apply).not.toHaveBeenCalled();
  });

  it('stays empty when a settled read has a null payload', () => {
    // WHY: a settled null payload is not an unread pause. Undefined data is
    // unread. Null has arrived, and the sync stays empty.
    hookMocks.query = {
      data: null,
      isLoading: false,
      isError: false,
      status: 'success',
      dataUpdatedAt: 1,
    };
    renderSync();

    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(hookMocks.apply).not.toHaveBeenCalled();
  });

  it('still applies a loaded currency', () => {
    // WHY: a loaded currency stays. The checking line must not replace a code
    // the read already returned.
    hookMocks.query = {
      data: loaded('EUR'),
      isLoading: false,
      isError: false,
      status: 'success',
      dataUpdatedAt: 2,
    };
    renderSync();

    expect(hookMocks.apply).toHaveBeenCalledTimes(1);
    expect(hookMocks.apply).toHaveBeenCalledWith('EUR');
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still keeps a loaded blank currency', () => {
    // WHY: a loaded blank currency is a blank field, not an unread pause and
    // not a default code. The checking line must not replace it.
    hookMocks.query = {
      data: loaded(''),
      isLoading: false,
      isError: false,
      status: 'success',
      dataUpdatedAt: 3,
    };
    renderSync();

    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(hookMocks.apply).not.toHaveBeenCalled();
  });

  it('still keeps a loaded zero', () => {
    // WHY: a loaded zero is a real value. Unread must not look like that
    // zero, and the zero must not be replaced with a default code.
    hookMocks.query = {
      data: loaded(0),
      isLoading: false,
      isError: false,
      status: 'success',
      dataUpdatedAt: 4,
    };
    renderSync();

    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(hookMocks.apply).not.toHaveBeenCalled();
  });
});

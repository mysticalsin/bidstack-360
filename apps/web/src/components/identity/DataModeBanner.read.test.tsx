// A paused or in-flight identity read has no mode yet. The banner hid, or
// it painted the last demo line. That read has not arrived, and a hidden
// banner is not a settled miss.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const hookMocks = vi.hoisted(() => ({
  query: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    status: 'pending' as string,
    dataUpdatedAt: 0,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
  }),
}));

vi.mock('@/hooks/usePoloIdentity', () => ({
  usePoloPublicIdentity: () => hookMocks.query,
}));

import { DataModeBanner } from './DataModeBanner';

const CHECKING = 'Checking the data mode. The mode has not arrived.';
const FAILED = 'Could not load the data mode.';

function renderBanner() {
  return render(
    <MemoryRouter>
      <DataModeBanner />
    </MemoryRouter>,
  );
}

function loaded(dataMode: 'demo' | 'real') {
  return {
    dataMode,
    authProvider: 'demo' as const,
    demoBanner: false,
    cfAccessEnabled: false,
  };
}

describe('DataModeBanner identity read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused identity read as off', () => {
    // WHY: a paused first read has isLoading false and no payload. Hiding
    // the banner is a settled miss. This read has not arrived.
    hookMocks.query = {
      data: undefined,
      isLoading: false,
      isError: false,
      status: 'pending',
      dataUpdatedAt: 0,
    };
    renderBanner();

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText('DEMO MODE')).toBeNull();
    expect(screen.queryByText(/Real-data mode/)).toBeNull();
    expect(screen.queryByTestId('data-mode-banner')).toBeNull();
    expect(screen.queryByTestId('data-mode-banner-placeholder')).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('does not treat an in-flight identity read as ready', () => {
    // WHY: a slow read also has no payload. The last demo line is not a
    // settled mode, and it is not a failed load.
    hookMocks.query = {
      data: undefined,
      isLoading: true,
      isError: false,
      status: 'pending',
      dataUpdatedAt: 0,
    };
    renderBanner();

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText('DEMO MODE')).toBeNull();
    expect(screen.queryByText(/Real-data mode/)).toBeNull();
    expect(screen.queryByTestId('data-mode-banner')).toBeNull();
    expect(screen.queryByTestId('data-mode-banner-placeholder')).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('keeps a failed identity read on the error', () => {
    // WHY: a failed read is not evidence that the banner is off. The error
    // stays, and a hidden banner does not stand in for the read.
    hookMocks.query = {
      data: undefined,
      isLoading: false,
      isError: true,
      status: 'error',
      dataUpdatedAt: 0,
    };
    renderBanner();

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText('DEMO MODE')).toBeNull();
    expect(screen.queryByText(/Real-data mode/)).toBeNull();
    expect(screen.queryByTestId('data-mode-banner')).toBeNull();
  });

  it('lets a failed read win over a stale real mode', () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // Real-data mode on screen from an identity that is no longer the read.
    hookMocks.query = {
      data: loaded('real'),
      isLoading: false,
      isError: true,
      status: 'error',
      dataUpdatedAt: 5,
    };
    renderBanner();

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(/Real-data mode/)).toBeNull();
    expect(screen.queryByText('DEMO MODE')).toBeNull();
    expect(screen.queryByTestId('data-mode-banner')).toBeNull();
  });

  it('lets a failed status win when isError is still false', () => {
    // WHY: a status of error is a failed read even if isError has not flipped.
    // A stale demo line must not stay.
    hookMocks.query = {
      data: loaded('demo'),
      isLoading: false,
      isError: false,
      status: 'error',
      dataUpdatedAt: 5,
    };
    renderBanner();

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText('DEMO MODE')).toBeNull();
    expect(screen.queryByText(/Real-data mode/)).toBeNull();
  });

  it('stays hidden when a settled read has a null payload', () => {
    // WHY: a settled null payload is not an unread pause. Undefined data is
    // unread. Null has arrived, and the banner stays hidden.
    hookMocks.query = {
      data: null,
      isLoading: false,
      isError: false,
      status: 'success',
      dataUpdatedAt: 1,
    };
    renderBanner();

    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText('DEMO MODE')).toBeNull();
    expect(screen.queryByText(/Real-data mode/)).toBeNull();
    expect(screen.queryByTestId('data-mode-banner')).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a loaded demo mode, including a false banner flag', () => {
    // WHY: a loaded identity stays. demoBanner false is a loaded false. The
    // checking line must not replace a mode the read already returned.
    hookMocks.query = {
      data: loaded('demo'),
      isLoading: false,
      isError: false,
      status: 'success',
      dataUpdatedAt: 2,
    };
    renderBanner();

    expect(screen.getByTestId('data-mode-banner')).toBeTruthy();
    expect(screen.getByText('DEMO MODE')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a loaded real mode', () => {
    // WHY: a loaded real mode stays. Unread must not look like that line,
    // and a real mode must stay.
    hookMocks.query = {
      data: loaded('real'),
      isLoading: false,
      isError: false,
      status: 'success',
      dataUpdatedAt: 3,
    };
    renderBanner();

    expect(screen.getByTestId('data-mode-banner')).toBeTruthy();
    expect(screen.getByText(/Real-data mode/)).toBeTruthy();
    expect(screen.queryByText('DEMO MODE')).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});

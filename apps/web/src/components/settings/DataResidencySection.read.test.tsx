// A paused or in-flight data region read has no setting yet. The section
// said the load failed. That read has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  useDataResidency: vi.fn(),
  useUpdateDataResidency: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock('@/hooks/useDataResidency', () => ({
  useDataResidency: hookMocks.useDataResidency,
  useUpdateDataResidency: hookMocks.useUpdateDataResidency,
}));

vi.mock('@/lib/auth', () => ({
  useIsAdmin: () => true,
}));

vi.mock('@/components/ui/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { DataResidencySection } from './DataResidencySection';

const CHECKING = 'Checking the data region. The setting has not arrived.';
const FAILED = 'Could not load the data region';
const NONE = 'No data region is saved.';

function view(region: 'eu' | 'uk' | 'us' | 'ca' | null, enforced = false, regionalStorage = false) {
  return { region, enforced, regionalStorage };
}

function renderRegion(query: {
  data?: unknown;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  status?: string;
  error?: Error | null;
}) {
  hookMocks.useDataResidency.mockReturnValue(query);
  hookMocks.useUpdateDataResidency.mockReturnValue({
    isPending: false,
    mutate: vi.fn(),
  });
  render(<DataResidencySection />);
}

describe('DataResidencySection read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused data region read as a failed load', () => {
    // WHY: a paused first read has isLoading false and no setting. Could not
    // load is the error. This read has not arrived.
    renderRegion({
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
    expect(screen.queryByLabelText('Data region')).toBeNull();
    expect(screen.queryByText('Strict mode is off.')).toBeNull();
    expect(screen.queryByText('Not pinned (deployment default)')).toBeNull();
    expect(screen.queryByText(NONE)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('does not treat an in-flight data region read as a failed load', () => {
    // WHY: a slow read also has no setting, and isLoading can stay false.
    // The load error must not stand in for a read that is still running.
    renderRegion({
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
    expect(screen.queryByLabelText('Data region')).toBeNull();
    expect(screen.queryByText('Strict mode is off.')).toBeNull();
    expect(screen.queryByText(NONE)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('keeps a failed data region read on the error', () => {
    // WHY: a failed read is not an unread pause. Checking must not stand in
    // for the error.
    renderRegion({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      status: 'error',
      error: new Error('region down'),
    });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.getByText('region down')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(NONE)).toBeNull();
    expect(screen.queryByLabelText('Data region')).toBeNull();
    expect(screen.queryByText('Strict mode is off.')).toBeNull();
  });

  it('lets a failed read win over a stale data region', () => {
    // WHY: error wins before a payload. A refetch failure must not keep the
    // region, and it must not say strict mode is off.
    renderRegion({
      data: view('eu', false, true),
      isLoading: false,
      isFetching: false,
      isError: true,
      status: 'error',
      error: new Error('region down'),
    });

    expect(screen.queryByLabelText('Data region')).toBeNull();
    expect(screen.queryByText('European Union')).toBeNull();
    expect(screen.queryByText('Strict mode is off.')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(NONE)).toBeNull();
  });

  it('stays empty when a settled payload is null', () => {
    // WHY: null has arrived. Undefined data is unread. A null payload is not
    // a failed load.
    renderRegion({
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
    expect(screen.queryByLabelText('Data region')).toBeNull();
    expect(screen.queryByText('Strict mode is off.')).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a loaded data region', () => {
    // WHY: a loaded payload stays. The unread line must not replace a region
    // the read already returned.
    renderRegion({
      data: view('eu', true, true),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect((screen.getByLabelText('Data region') as HTMLSelectElement).value).toBe('eu');
    expect(screen.getByText(/A regional bucket is configured for this region/)).toBeTruthy();
    expect(screen.getByText(/Strict mode is on/)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(NONE)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a loaded data region when it is not pinned', () => {
    // WHY: a blank region is loaded data. Unread must not drop the setting
    // because the region is not pinned, and it must not call that a failure.
    renderRegion({
      data: view(null, false, false),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect((screen.getByLabelText('Data region') as HTMLSelectElement).value).toBe('');
    expect(screen.getByText(/Strict mode is off/)).toBeTruthy();
    expect(screen.getByText('Not pinned (deployment default)')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(NONE)).toBeNull();
  });
});

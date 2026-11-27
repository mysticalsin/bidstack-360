// A data region shell is not a settled setting. Placeholder data, a pending
// payload, and a partial object have not arrived. The section must not call
// that Not pinned, and it must not say a bucket is available.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  useDataResidency: vi.fn(),
  useUpdateDataResidency: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
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

const NOT_ARRIVED = 'The data region has not arrived.';
const FAILED = 'Could not load the data region';
const NOT_PINNED = 'Not pinned (deployment default)';
const DEFAULT_BUCKET = /exports use the default bucket/i;
const BUCKET_READY = /A regional bucket is configured for this region/;
const STRICT_OFF = /Strict mode is off\./;

function view(region: 'eu' | 'uk' | 'us' | 'ca' | null, enforced = false, regionalStorage = false) {
  return { region, enforced, regionalStorage };
}

function renderRegion(query: {
  data?: unknown;
  isLoading: boolean;
  isFetching?: boolean;
  isError: boolean;
  isPlaceholderData?: boolean;
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

describe('DataResidencySection arrival', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not call a placeholder unpinned shell Not pinned or available', () => {
    // WHY: placeholder data is the stand-in, not the read. Not pinned and the
    // default bucket are claims about a setting that has not arrived.
    renderRegion({
      data: view(null, false, false),
      isLoading: false,
      isFetching: true,
      isError: false,
      isPlaceholderData: true,
      status: 'success',
      error: null,
    });

    expect(screen.getByRole('status').textContent).toBe(NOT_ARRIVED);
    expect(screen.queryByText(NOT_PINNED)).toBeNull();
    expect(screen.queryByText(DEFAULT_BUCKET)).toBeNull();
    expect(screen.queryByText(BUCKET_READY)).toBeNull();
    expect(screen.queryByText(STRICT_OFF)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByLabelText('Data region')).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('does not say a regional bucket is configured while the placeholder is still in flight', () => {
    // WHY: a placeholder can already look like EU with storage ready. That
    // available line is a lie until the read settles.
    renderRegion({
      data: view('eu', true, true),
      isLoading: false,
      isFetching: true,
      isError: false,
      isPlaceholderData: true,
      status: 'success',
      error: null,
    });

    expect(screen.getByText(NOT_ARRIVED)).toBeTruthy();
    expect(screen.queryByText(BUCKET_READY)).toBeNull();
    expect(screen.queryByText(/Strict mode is on/)).toBeNull();
    expect(screen.queryByText('European Union')).toBeNull();
    expect(screen.queryByLabelText('Data region')).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('does not paint a pending shell as a saved region', () => {
    // WHY: status pending means the read has not settled, even when a full
    // looking object is already on the query. Available must wait.
    renderRegion({
      data: view('eu', true, true),
      isLoading: false,
      isFetching: true,
      isError: false,
      isPlaceholderData: false,
      status: 'pending',
      error: null,
    });

    expect(screen.getByText(NOT_ARRIVED)).toBeTruthy();
    expect(screen.queryByText(BUCKET_READY)).toBeNull();
    expect(screen.queryByText(NOT_PINNED)).toBeNull();
    expect(screen.queryByText(DEFAULT_BUCKET)).toBeNull();
    expect(screen.queryByLabelText('Data region')).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('does not keep a stale available region when the status failed and isError is still false', () => {
    // WHY: a failed read can leave isError false while status is already
    // error. The stale "bucket is configured" line must not survive that.
    renderRegion({
      data: view('eu', true, true),
      isLoading: false,
      isFetching: false,
      isError: false,
      isPlaceholderData: false,
      status: 'error',
      error: new Error('region down'),
    });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.getByText('region down')).toBeTruthy();
    expect(screen.queryByText(NOT_ARRIVED)).toBeNull();
    expect(screen.queryByText(BUCKET_READY)).toBeNull();
    expect(screen.queryByText(NOT_PINNED)).toBeNull();
    expect(screen.queryByText(DEFAULT_BUCKET)).toBeNull();
    expect(screen.queryByText(STRICT_OFF)).toBeNull();
    expect(screen.queryByLabelText('Data region')).toBeNull();
  });

  it('does not read a partial payload as Not pinned with the default bucket', () => {
    // WHY: region, enforcement, and storage are one view. A shell that omits
    // them has not arrived. Missing booleans must not become strict off and
    // "exports use the default bucket".
    renderRegion({
      data: { region: null },
      isLoading: false,
      isFetching: false,
      isError: false,
      isPlaceholderData: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByText(NOT_ARRIVED)).toBeTruthy();
    expect(screen.queryByText(NOT_PINNED)).toBeNull();
    expect(screen.queryByText(DEFAULT_BUCKET)).toBeNull();
    expect(screen.queryByText(STRICT_OFF)).toBeNull();
    expect(screen.queryByText(BUCKET_READY)).toBeNull();
    expect(screen.queryByLabelText('Data region')).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a settled region that is not pinned', () => {
    // WHY: a settled unpinned view is a real setting. Withholding must not
    // hide Not pinned once enforced and storage have arrived with it.
    renderRegion({
      data: view(null, false, false),
      isLoading: false,
      isFetching: false,
      isError: false,
      isPlaceholderData: false,
      status: 'success',
      error: null,
    });

    expect((screen.getByLabelText('Data region') as HTMLSelectElement).value).toBe('');
    expect(screen.getByText(NOT_PINNED)).toBeTruthy();
    expect(screen.getByText(DEFAULT_BUCKET)).toBeTruthy();
    expect(screen.getByText(STRICT_OFF)).toBeTruthy();
    expect(screen.queryByText(NOT_ARRIVED)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('still shows a settled region whose bucket is configured', () => {
    // WHY: a settled regional view stays. The not-arrived line must not
    // replace a bucket the read already confirmed.
    renderRegion({
      data: view('eu', true, true),
      isLoading: false,
      isFetching: false,
      isError: false,
      isPlaceholderData: false,
      status: 'success',
      error: null,
    });

    expect((screen.getByLabelText('Data region') as HTMLSelectElement).value).toBe('eu');
    expect(screen.getByText(BUCKET_READY)).toBeTruthy();
    expect(screen.getByText(/Strict mode is on/)).toBeTruthy();
    expect(screen.queryByText(NOT_ARRIVED)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('keeps a paused read with no payload on the load error', () => {
    // WHY: an unread query with no data already says the load failed. This
    // slice must not retitle that case. It only stops a shell from reading
    // as Not pinned or available.
    renderRegion({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'pending',
      error: null,
    });

    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(NOT_ARRIVED)).toBeNull();
    expect(screen.queryByText(NOT_PINNED)).toBeNull();
    expect(screen.queryByText(DEFAULT_BUCKET)).toBeNull();
    expect(screen.queryByText(BUCKET_READY)).toBeNull();
    expect(screen.queryByLabelText('Data region')).toBeNull();
  });

  it('keeps the skeleton while the first load is still marked loading', () => {
    // WHY: a loading flag is not a region. A shell parked under that flag
    // must not flash Not pinned before the skeleton.
    renderRegion({
      data: view(null, false, false),
      isLoading: true,
      isFetching: true,
      isError: false,
      isPlaceholderData: true,
      status: 'pending',
      error: null,
    });

    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(screen.queryByText(NOT_ARRIVED)).toBeNull();
    expect(screen.queryByText(NOT_PINNED)).toBeNull();
    expect(screen.queryByText(DEFAULT_BUCKET)).toBeNull();
    expect(screen.queryByText(BUCKET_READY)).toBeNull();
    expect(screen.queryByLabelText('Data region')).toBeNull();
  });
});

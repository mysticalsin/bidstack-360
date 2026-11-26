// A paused or in-flight sample-data status has no payload yet. The banner
// hid, which is the same as a settled "off". That read has not arrived.
// A failed read hid the same way, so a failure looked like sample data was off.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  status: {
    data: undefined as { hasSampleData: boolean } | undefined,
    isLoading: false,
    isError: false,
    status: 'pending' as string,
    fetchStatus: 'idle' as 'idle' | 'fetching' | 'paused',
  },
  mutate: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('@/hooks/useOnboarding', () => ({
  useSampleDataStatus: () => hookMocks.status,
  useDeleteSampleData: () => ({ mutate: hookMocks.mutate, isPending: false }),
}));

import { SampleDataBanner } from './SampleDataBanner';

const CHECKING = 'Checking sample data. The status has not arrived.';
const FAILED = 'Could not check sample data.';
const ON = 'Sample data is on';

function settle(
  data: { hasSampleData: boolean } | undefined,
  extra: Partial<typeof hookMocks.status> = {},
) {
  hookMocks.status = {
    data,
    isLoading: false,
    isError: false,
    status: data === undefined ? 'pending' : 'success',
    fetchStatus: 'idle',
    ...extra,
  };
}

function renderBanner() {
  return render(<SampleDataBanner />);
}

function expectNotOn() {
  expect(screen.queryByText(ON)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Remove sample data' })).toBeNull();
}

describe('SampleDataBanner unread status', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused status read as sample data off', async () => {
    // WHY: a paused first read has isLoading false and no payload. Hiding
    // the banner is the settled off state. The status has not arrived.
    settle(undefined, { status: 'pending', fetchStatus: 'paused' });
    renderBanner();

    expect(await screen.findByText(CHECKING)).toBeTruthy();
    expectNotOn();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not treat an in-flight status read as sample data off', async () => {
    // WHY: a slow read also has no payload. Silence is not a settled off.
    settle(undefined, { isLoading: true, status: 'pending', fetchStatus: 'fetching' });
    renderBanner();

    expect(await screen.findByText(CHECKING)).toBeTruthy();
    expectNotOn();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps a failed status read on the error', async () => {
    // WHY: a failed read is not evidence that sample data is off. The error
    // stays, and the banner does not disappear as if the status arrived false.
    settle(undefined, { isError: true, status: 'error', fetchStatus: 'idle' });
    renderBanner();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expectNotOn();
  });

  it('lets a failed read win over a stale on payload', async () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // claiming sample data is on from a payload that is no longer the read.
    settle({ hasSampleData: true }, { isError: true, status: 'error', fetchStatus: 'idle' });
    renderBanner();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expectNotOn();
  });

  it('stays hidden when a settled status says sample data is off', () => {
    // WHY: a status that arrived false stays quiet. A slow network must not
    // be dressed up as that outcome, and this one must.
    settle({ hasSampleData: false });
    renderBanner();

    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expectNotOn();
  });

  it('still shows the banner when a settled status says sample data is on', async () => {
    // WHY: a loaded on status stays. The unread line must not replace a
    // status the read already returned.
    settle({ hasSampleData: true });
    renderBanner();

    expect(await screen.findByText(ON)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove sample data' })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

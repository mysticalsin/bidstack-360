// A paused or in-flight feature-flag read has no payload yet. The cockpit
// treated that as every flag off. A settled off flag stays off. A failed
// read stays on the error.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FeatureFlags } from '@bidstack/shared';

import {
  featureFlagsPhase,
  type FeatureFlagSnapshot,
} from '@/hooks/feature-flags-read';

interface FlagQuery {
  data?: FeatureFlags | null;
  isError: boolean;
  isLoading: boolean;
  status: string;
}

const ALL_OFF: FeatureFlags = {
  winLossDataAvailable: false,
  showRevenueBlock: false,
  infosearchEnabled: false,
  lms360Enabled: false,
  serumEnabled: false,
  serumDemoModeEnabled: false,
  msaLlmExtractEnabled: false,
};

const REVENUE_ON: FeatureFlags = { ...ALL_OFF, showRevenueBlock: true };

const queryState = vi.hoisted(() => ({
  current: {
    data: undefined,
    isError: false,
    isLoading: false,
    status: 'pending',
  } as FlagQuery,
}));

vi.mock('@/hooks/useFeatureFlags', () => ({
  useFeatureFlags: () => queryState.current.data ?? ALL_OFF,
  useFeatureFlagQuery: () => queryState.current,
}));

import { FeatureFlagsStatus } from './FeatureFlagsStatus';

const CHECKING = 'Checking feature flags. The read has not arrived.';
const FAILED = 'Could not load feature flags.';
const LOADED = 'Revenue block on';

function settle(data: FeatureFlags | null | undefined, extra: Partial<FlagQuery> = {}) {
  queryState.current = {
    data,
    isError: false,
    isLoading: false,
    status: data === undefined ? 'pending' : 'success',
    ...extra,
  };
}

function renderStatus(children?: string) {
  return render(<FeatureFlagsStatus>{children}</FeatureFlagsStatus>);
}

describe('Feature flag read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused flag read as off', () => {
    // WHY: a paused first read has isLoading false and no payload. Every
    // flag false is a settled off switch. This payload has not arrived.
    settle(undefined, { status: 'pending', isLoading: false });
    renderStatus(LOADED);

    expect(screen.getByRole('status').textContent).toBe(CHECKING);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(LOADED)).toBeNull();
  });

  it('does not treat an in-flight flag read with isLoading false as off', () => {
    // WHY: a slow read can report isLoading false while data is still
    // undefined. That is not a settled off switch.
    settle(undefined, { status: 'pending', isLoading: false });
    renderStatus(LOADED);

    expect(screen.getByRole('status').textContent).toBe(CHECKING);
    expect(screen.queryByText(LOADED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not treat an in-flight flag read as off', () => {
    // WHY: the first fetch has no payload. Hiding the blocks as if every
    // flag were off is a settled answer. The payload has not arrived.
    settle(undefined, { status: 'pending', isLoading: true });
    renderStatus(LOADED);

    expect(screen.getByRole('status').textContent).toBe(CHECKING);
    expect(screen.queryByText(LOADED)).toBeNull();
  });

  it('keeps a failed flag read on the error', () => {
    // WHY: a failed read is not an unread pause and not an off switch.
    settle(undefined, { isError: true, status: 'error', isLoading: false });
    renderStatus(LOADED);

    expect(screen.getByRole('alert').textContent).toBe(FAILED);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(LOADED)).toBeNull();
  });

  it('lets a failed status win over a stale flag', () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // Revenue block on from a read that is no longer current.
    settle(REVENUE_ON, { isError: false, status: 'error', isLoading: false });
    renderStatus(LOADED);

    expect(screen.getByRole('alert').textContent).toBe(FAILED);
    expect(screen.queryByText(LOADED)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('drops a stale revenue flag when the read is in error', () => {
    // WHY: isError wins even when a previous on flag is still in data.
    settle(REVENUE_ON, { isError: true, status: 'error', isLoading: false });
    renderStatus(LOADED);

    expect(screen.getByRole('alert').textContent).toBe(FAILED);
    expect(screen.queryByText(LOADED)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('stays quiet when a settled read says every flag is off', () => {
    // WHY: a payload that arrived with every switch false is off. Unread
    // must not replace that, and off must not say the load failed.
    settle(ALL_OFF);
    renderStatus();

    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText(LOADED)).toBeNull();
  });

  it('stays quiet when a settled null payload arrives', () => {
    // WHY: null is a settled payload, not an unread pause and not a failed
    // read. It stays an empty off result.
    settle(null);
    renderStatus();

    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText(LOADED)).toBeNull();
  });

  it('still shows a loaded revenue flag', () => {
    // WHY: a loaded on switch stays. The unread sentence is only for a
    // payload that has not arrived. A false sibling flag stays false.
    settle(REVENUE_ON);
    renderStatus(LOADED);

    expect(screen.getByText(LOADED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

function snapshot(overrides: Partial<FeatureFlagSnapshot>): FeatureFlagSnapshot {
  return { data: undefined, isError: false, status: 'pending', ...overrides };
}

describe('featureFlagsPhase', () => {
  it('lets error win over a payload', () => {
    expect(featureFlagsPhase(snapshot({ data: REVENUE_ON, isError: true, status: 'error' }))).toBe(
      'failed',
    );
    expect(featureFlagsPhase(snapshot({ data: REVENUE_ON, isError: false, status: 'error' }))).toBe(
      'failed',
    );
  });

  it('treats undefined data as unread', () => {
    expect(featureFlagsPhase(snapshot({ data: undefined, isLoading: false } as FeatureFlagSnapshot))).toBe(
      'unread',
    );
  });

  it('treats null and a false flag as ready', () => {
    // WHY: null is a settled empty payload. false is a real off switch, not
    // an unread hole.
    expect(featureFlagsPhase(snapshot({ data: null, status: 'success' }))).toBe('ready');
    expect(featureFlagsPhase(snapshot({ data: ALL_OFF, status: 'success' }))).toBe('ready');
    expect(featureFlagsPhase(snapshot({ data: REVENUE_ON, status: 'success' }))).toBe('ready');
  });
});

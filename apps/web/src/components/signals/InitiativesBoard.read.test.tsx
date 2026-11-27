// A paused or in-flight initiatives read has no payload yet. The board
// called that a failed load. That read has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AccountInitiatives, Initiative } from '@bidstack/shared';

interface InitiativesSnapshot {
  data?: AccountInitiatives;
  isLoading: boolean;
  isError: boolean;
  status: string;
  fetchStatus: 'idle' | 'fetching' | 'paused';
  refetch: () => Promise<unknown>;
}

const hookMocks = vi.hoisted(() => ({
  initiatives: {
    data: undefined,
    isLoading: false,
    isError: false,
    status: 'pending',
    fetchStatus: 'idle',
    refetch: () => Promise.resolve(),
  } as InitiativesSnapshot,
}));

vi.mock('@/hooks/useAccountSignals', () => ({
  useAccountInitiatives: () => hookMocks.initiatives,
}));

import { InitiativesBoard } from './InitiativesBoard';

const CHECKING = 'Checking initiatives. The list has not arrived.';
const FAILED = "Couldn't load initiatives";
const EMPTY = 'No initiatives spotted yet';
const TITLE = 'Data platform expansion';

const INITIATIVE: Initiative = {
  id: 'in-data',
  title: TITLE,
  theme: 'data_ai',
  themeLabel: 'Data and AI',
  rationale: 'Hiring data engineers and announced a data platform.',
  confidence: 'high',
  confidenceScore: 0.8,
  firstSeen: null,
  lastSeen: '2026-10-01T00:00:00.000Z',
  evidence: [],
  hook: {
    offering: 'Data and AI practice',
    pitch: '',
    nextStep: 'Offer a data platform assessment.',
    alreadySold: false,
  },
  sample: false,
};

const LOADED: AccountInitiatives = { companyId: 'northwind', items: [INITIATIVE] };
const SETTLED_EMPTY: AccountInitiatives = { companyId: 'northwind', items: [] };

function settle(data: AccountInitiatives | undefined, extra: Partial<InitiativesSnapshot> = {}) {
  hookMocks.initiatives = {
    data,
    isLoading: false,
    isError: false,
    status: data === undefined ? 'pending' : 'success',
    fetchStatus: 'idle',
    refetch: () => Promise.resolve(),
    ...extra,
  };
}

function renderBoard() {
  return render(<InitiativesBoard companyId="northwind" />);
}

describe('InitiativesBoard list read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused initiatives read as a failed load', () => {
    // WHY: a paused first read has isLoading false and no payload. Couldn't
    // load initiatives is a failed read. The list has not arrived.
    settle(undefined, { status: 'pending', fetchStatus: 'paused' });
    renderBoard();

    expect(screen.queryByRole('heading', { name: TITLE })).toBeNull();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it('does not treat an in-flight initiatives read as a failed load', () => {
    // WHY: a slow read also has no payload. A skeleton with no status is not
    // a settled empty list, and it is not a failed load.
    settle(undefined, { isLoading: true, status: 'pending', fetchStatus: 'fetching' });
    renderBoard();

    expect(screen.queryByRole('heading', { name: TITLE })).toBeNull();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it('keeps a failed initiatives read on the error', () => {
    // WHY: a failed read is not evidence that the list is empty. The error
    // stays, and a blank board does not stand in for the list.
    settle(undefined, { isError: true, status: 'error', fetchStatus: 'idle' });
    renderBoard();

    expect(screen.queryByRole('heading', { name: TITLE })).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it('lets a failed read win over a stale initiative', () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // showing an initiative from a list that is no longer the read.
    settle(LOADED, { isError: true, status: 'error', fetchStatus: 'idle' });
    renderBoard();

    expect(screen.queryByRole('heading', { name: TITLE })).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it('stays empty when a settled initiatives list has no rows', () => {
    // WHY: a list that arrived with no rows stays empty. A slow network must
    // not be dressed up as that outcome, and this one must.
    settle(SETTLED_EMPTY);
    renderBoard();

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: TITLE })).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still shows an initiative when the list has arrived', () => {
    // WHY: a loaded initiative stays. The unread line must not replace a row
    // the list already returned.
    settle(LOADED);
    renderBoard();

    expect(screen.getByRole('heading', { name: TITLE })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

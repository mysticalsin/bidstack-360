// A paused or in-flight account pulse has no payload yet. The card called
// that a failed load. That read has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import type { AccountPulse } from '@bidstack/shared';

interface PulseSnapshot {
  data?: AccountPulse;
  isLoading: boolean;
  isError: boolean;
  status: string;
  fetchStatus: 'idle' | 'fetching' | 'paused';
  refetch: () => Promise<unknown>;
}

const hookMocks = vi.hoisted(() => ({
  pulse: {
    data: undefined,
    isLoading: false,
    isError: false,
    status: 'pending',
    fetchStatus: 'idle',
    refetch: () => Promise.resolve(),
  } as PulseSnapshot,
}));

vi.mock('@/hooks/useAccountSignals', () => ({
  useAccountPulse: () => hookMocks.pulse,
}));

import { PulseHero } from './PulseHero';

const CHECKING = 'Checking this pulse. The record has not arrived.';
const FAILED = "Couldn't load the account pulse";
const EMPTY_VERDICT = 'No movement on this pulse yet.';
const LOADED_VERDICT = 'Gaining traction: pipeline growing and meetings more frequent.';
const DRIVER = 'Pipeline';

const LOADED: AccountPulse = {
  companyId: 'northwind',
  companyName: 'Northwind',
  score: 78,
  delta: 12,
  trend: 'gaining',
  verdict: LOADED_VERDICT,
  coverage: 0.8,
  series: [{ at: '2026-10-31T00:00:00.000Z', score: 78 }],
  drivers: [
    { key: 'pipeline', label: DRIVER, signal: 0.6, points: 9, direction: 'up', detail: 'Open pipeline up on 90 days ago.' },
    { key: 'meetings', label: 'Meetings', signal: 0.5, points: 7, direction: 'up', detail: 'Meetings are up.' },
    { key: 'winloss', label: 'Win and loss', signal: 0, points: 0, direction: 'flat', detail: 'No closed deals.' },
    { key: 'hiring', label: 'Hiring', signal: 0.2, points: 2, direction: 'up', detail: 'Postings are up.' },
    { key: 'news', label: 'News', signal: -0.4, points: -4, direction: 'down', detail: 'One risk story.' },
  ],
  sample: false,
  sources: [],
  computedAt: '2026-10-31T00:00:00.000Z',
};

const SETTLED_EMPTY: AccountPulse = {
  companyId: 'northwind',
  companyName: 'Northwind',
  score: 0,
  delta: 0,
  trend: 'steady',
  verdict: EMPTY_VERDICT,
  coverage: 0,
  series: [{ at: '2026-10-31T00:00:00.000Z', score: 0 }],
  drivers: [],
  sample: false,
  sources: [],
  computedAt: '2026-10-31T00:00:00.000Z',
};

function settle(data: AccountPulse | undefined, extra: Partial<PulseSnapshot> = {}) {
  hookMocks.pulse = {
    data,
    isLoading: false,
    isError: false,
    status: data === undefined ? 'pending' : 'success',
    fetchStatus: 'idle',
    refetch: () => Promise.resolve(),
    ...extra,
  };
}

function renderCard() {
  return render(
    <MemoryRouter>
      <PulseHero companyId="northwind" />
    </MemoryRouter>,
  );
}

describe('PulseHero read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused pulse read as a failed load', () => {
    // WHY: a paused first read has isLoading false and no payload. Couldn't
    // load the account pulse is a failed read. The record has not arrived.
    settle(undefined, { status: 'pending', fetchStatus: 'paused' });
    renderCard();

    expect(screen.queryByText(LOADED_VERDICT)).toBeNull();
    expect(screen.queryByText(EMPTY_VERDICT)).toBeNull();
    expect(screen.queryByRole('button', { name: DRIVER })).toBeNull();
    expect(screen.getAllByText(CHECKING).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(FAILED)).toHaveLength(0);
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('does not treat an in-flight pulse read as a failed load', () => {
    // WHY: a slow read also has no payload. A skeleton with no status is not
    // a settled pulse, and it is not a failed load.
    settle(undefined, { isLoading: true, status: 'pending', fetchStatus: 'fetching' });
    renderCard();

    expect(screen.queryByText(LOADED_VERDICT)).toBeNull();
    expect(screen.queryByText(EMPTY_VERDICT)).toBeNull();
    expect(screen.queryByRole('button', { name: DRIVER })).toBeNull();
    expect(screen.getAllByText(CHECKING).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(FAILED)).toHaveLength(0);
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('keeps a failed pulse read on the error', () => {
    // WHY: a failed read is not evidence that the pulse is empty. The error
    // stays, and a blank card does not stand in for the record.
    settle(undefined, { isError: true, status: 'error', fetchStatus: 'idle' });
    renderCard();

    expect(screen.queryByText(LOADED_VERDICT)).toBeNull();
    expect(screen.queryByText(EMPTY_VERDICT)).toBeNull();
    expect(screen.queryByRole('button', { name: DRIVER })).toBeNull();
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(screen.getAllByText(FAILED).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('lets a failed read win over a stale pulse', () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // showing a pulse from a read that is no longer current.
    settle(LOADED, { isError: true, status: 'error', fetchStatus: 'idle' });
    renderCard();

    expect(screen.queryByText(LOADED_VERDICT)).toBeNull();
    expect(screen.queryByRole('button', { name: DRIVER })).toBeNull();
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(screen.getAllByText(FAILED).length).toBeGreaterThan(0);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY_VERDICT)).toBeNull();
  });

  it('stays on the pulse when a settled read has no drivers', () => {
    // WHY: a pulse that arrived with no drivers stays on that pulse. A slow
    // network must not be dressed up as that outcome, and this one must.
    settle(SETTLED_EMPTY);
    renderCard();

    expect(screen.getByRole('heading', { name: 'Account pulse' })).toBeTruthy();
    expect(screen.getByText(EMPTY_VERDICT)).toBeTruthy();
    expect(screen.getByText('Early read, few signals')).toBeTruthy();
    expect(screen.queryByRole('button', { name: DRIVER })).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a pulse when the read has arrived', () => {
    // WHY: a loaded pulse stays. The unread line must not replace a score
    // the read already returned.
    settle(LOADED);
    renderCard();

    expect(screen.getByRole('heading', { name: 'Account pulse' })).toBeTruthy();
    expect(screen.getByText(LOADED_VERDICT)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Pipeline/ })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(EMPTY_VERDICT)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});

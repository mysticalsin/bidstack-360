// A paused or in-flight owner read has no payload yet. The picker showed
// only "Select an owner", which is a settled empty list. That read has not
// arrived. A failed read did the same, so a failure looked like no owners.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface Owner {
  id: string;
  name: string | null;
  email: string;
}

const hookMocks = vi.hoisted(() => ({
  query: {
    data: undefined as Owner[] | undefined,
    isLoading: false,
    isError: false,
    status: 'pending' as string,
    fetchStatus: 'idle' as 'idle' | 'fetching' | 'paused',
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
  }),
}));

vi.mock('@/hooks/useUsers', () => ({
  useUsers: () => hookMocks.query,
}));

import { TerritoryDialog } from './TerritoryDialog';

const CHECKING = 'Checking owners. The list has not arrived.';
const FAILED = 'Could not load owners.';
const PLACEHOLDER = 'Select an owner';

const ADA: Owner = { id: 'ada', name: 'Ada Owner', email: 'ada@example.com' };

function settle(data: Owner[] | undefined, extra: Partial<typeof hookMocks.query> = {}) {
  hookMocks.query = {
    data,
    isLoading: false,
    isError: false,
    status: data === undefined ? 'pending' : 'success',
    fetchStatus: 'idle',
    ...extra,
  };
}

function renderDialog() {
  return render(
    <TerritoryDialog open onClose={() => undefined} onSubmit={() => undefined} />,
  );
}

describe('TerritoryDialog owner list', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused owner read as an empty list', () => {
    // WHY: a paused first read has isLoading false and no payload. "Select an
    // owner" with no names is a settled empty list. The owners have not arrived.
    settle(undefined, { status: 'pending', fetchStatus: 'paused' });
    renderDialog();

    expect(screen.queryByRole('option', { name: ADA.name ?? '' })).toBeNull();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(PLACEHOLDER)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not treat an in-flight owner read as an empty list', () => {
    // WHY: a slow read also has no payload. The placeholder is not a settled
    // empty owner list.
    settle(undefined, { isLoading: true, status: 'pending', fetchStatus: 'fetching' });
    renderDialog();

    expect(screen.queryByRole('option', { name: ADA.name ?? '' })).toBeNull();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(PLACEHOLDER)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps a failed owner read on the error', () => {
    // WHY: a failed read is not evidence that no owners exist. The error stays,
    // and the empty placeholder does not stand in for the list.
    settle(undefined, { isError: true, status: 'error', fetchStatus: 'idle' });
    renderDialog();

    expect(screen.queryByRole('option', { name: ADA.name ?? '' })).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(PLACEHOLDER)).toBeNull();
  });

  it('lets a failed read win over a stale owner', () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // showing Ada from a payload that is no longer the read.
    settle([ADA], { isError: true, status: 'error', fetchStatus: 'idle' });
    renderDialog();

    expect(screen.queryByRole('option', { name: 'Ada Owner' })).toBeNull();
    expect(screen.queryByText('Ada Owner')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(PLACEHOLDER)).toBeNull();
  });

  it('stays empty when a settled owner list has no people', () => {
    // WHY: a list that arrived empty stays empty. A slow network must not be
    // dressed up as that outcome, and this one must.
    settle([]);
    renderDialog();

    expect(screen.getByRole('combobox', { name: 'Owner' })).toBeTruthy();
    expect(screen.getByRole('option', { name: PLACEHOLDER })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Ada Owner' })).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still shows an owner when the list has arrived', () => {
    // WHY: a loaded owner stays. The unread line must not replace a person the
    // read already returned.
    settle([ADA]);
    renderDialog();

    expect(screen.getByRole('option', { name: 'Ada Owner' })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

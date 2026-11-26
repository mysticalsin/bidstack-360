import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RelationshipMap, RelationshipRow } from '@bidstack/shared';

import { WhoWorksWithThem } from './WhoWorksWithThem';

const COMPANY = 'c0000000-0000-4000-8000-000000000001';
const OWNER = 'a0000000-0000-4000-8000-0000000000aa';

/**
 * The value column is the commercial book for this account group.
 * A read that has not arrived must not say the book is empty, and a failed
 * read must not keep a stale amount.
 */
const read = vi.hoisted(() => ({
  current: {
    data: undefined as RelationshipMap | null | undefined,
    isLoading: false,
    isFetching: false,
    isPending: false,
    isError: false,
    status: 'success' as 'pending' | 'error' | 'success',
    fetchStatus: 'idle' as 'paused' | 'fetching' | 'idle',
    error: null as Error | null,
  },
}));

vi.mock('@/hooks/useMsaWhitespace', () => ({
  useRelationshipMap: () => read.current,
}));

function row(over: Partial<RelationshipRow> = {}): RelationshipRow {
  return {
    kind: 'revenue',
    id: 'rev-1',
    label: 'Digital run',
    companyId: COMPANY,
    companyName: 'Northwind Advisory',
    entity: 'Northwind',
    line: 'digital',
    owner: { id: OWNER, name: 'Avery North' },
    lastActivityAt: '2026-08-01T00:00:00.000Z',
    valueMicros: 250_000_000_000,
    currency: 'EUR',
    country: 'FR',
    ...over,
  };
}

function settledMap(rows: RelationshipRow[]): RelationshipMap {
  return {
    companyId: COMPANY,
    companies: [
      { id: COMPANY, name: 'Northwind Advisory', relation: 'self', country: 'FR' },
      {
        id: 'c0000000-0000-4000-8000-000000000002',
        name: 'Northwind Labs',
        relation: 'affiliate',
        country: 'DE',
      },
    ],
    entities: [],
    people: [],
    rows,
    lines: [],
    countries: ['FR'],
  };
}

function show(next: Partial<typeof read.current>) {
  read.current = {
    data: undefined,
    isLoading: false,
    isFetching: false,
    isPending: false,
    isError: false,
    status: 'success',
    fetchStatus: 'idle',
    error: null,
    ...next,
  };
  render(<WhoWorksWithThem companyId={COMPANY} />);
}

afterEach(() => {
  cleanup();
});

describe('WhoWorksWithThem value read', () => {
  it('a paused read does not say the commercial book is empty', () => {
    show({ status: 'pending', fetchStatus: 'paused', isPending: true, data: undefined });
    expect(screen.getByRole('status').textContent).toBe('Checking who works with them.');
    expect(screen.queryByText('No one in the group works with them yet.')).toBeNull();
  });

  it('an in-flight read does not say the commercial book is empty', () => {
    show({
      status: 'pending',
      fetchStatus: 'fetching',
      isPending: true,
      isFetching: true,
      isLoading: false,
      data: undefined,
    });
    expect(screen.getByRole('status').textContent).toBe('Checking who works with them.');
    expect(screen.queryByText('No one in the group works with them yet.')).toBeNull();
  });

  it('a failed read says the value list could not load', () => {
    show({ status: 'error', isError: true, error: new Error('down'), data: undefined });
    expect(screen.getByRole('alert').textContent).toBe('Could not load who works with them.');
    expect(screen.queryByText('No one in the group works with them yet.')).toBeNull();
  });

  it('a failed read does not keep a stale commercial value', () => {
    show({ status: 'error', isError: true, data: settledMap([row()]) });
    expect(screen.getByRole('alert').textContent).toBe('Could not load who works with them.');
    expect(screen.queryByText('Avery North')).toBeNull();
    expect(screen.queryByText(/€/)).toBeNull();
    expect(screen.queryByText('Northwind Labs')).toBeNull();
  });

  it('a failed status with isError still false does not keep a stale commercial value', () => {
    show({ status: 'error', isError: false, data: settledMap([row()]) });
    expect(screen.getByRole('alert').textContent).toBe('Could not load who works with them.');
    expect(screen.queryByText('Avery North')).toBeNull();
    expect(screen.queryByText(/€/)).toBeNull();
  });

  it('a settled null payload stays on the empty book', () => {
    show({ status: 'success', data: null });
    expect(screen.getByText('No one in the group works with them yet.')).toBeTruthy();
  });

  it('a settled list with no rows stays empty', () => {
    show({ status: 'success', data: settledMap([]) });
    expect(screen.getByText('No one in the group works with them yet.')).toBeTruthy();
  });

  it('a loaded value stays, including the amount', () => {
    show({ status: 'success', data: settledMap([row()]) });
    expect(screen.getByText('Avery North')).toBeTruthy();
    expect(screen.getByText(/€250/)).toBeTruthy();
    expect(screen.getByText('Northwind Labs')).toBeTruthy();
  });

  it('a loaded row with a blank value does not invent zero', () => {
    show({
      status: 'success',
      data: settledMap([row({ valueMicros: null, currency: null })]),
    });
    expect(screen.getByText('Avery North')).toBeTruthy();
    expect(screen.queryByText(/€0/)).toBeNull();
  });
});

// A paused or in-flight field catalog has no payload yet. The picker showed
// the hard-coded schema, which is a loaded list. That read has not arrived.
// A failed read did the same, so a failure looked like a settled catalog.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface FieldDef {
  key: string;
  label: string;
  type: 'string' | 'number' | 'date' | 'boolean' | 'enum';
}

const hookMocks = vi.hoisted(() => ({
  query: {
    data: undefined as FieldDef[] | undefined,
    isLoading: false,
    isError: false,
    status: 'pending' as string,
    fetchStatus: 'idle' as 'idle' | 'fetching' | 'paused',
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => hookMocks.query,
}));

import { FieldPicker } from './FieldPicker';

const CHECKING = 'Checking fields. The list has not arrived.';
const FAILED = 'Could not load fields.';
const PLACEHOLDER = 'Pick a field…';

const STATUS: FieldDef = { key: 'status', label: 'Status', type: 'enum' };

function settle(data: FieldDef[] | undefined, extra: Partial<typeof hookMocks.query> = {}) {
  hookMocks.query = {
    data,
    isLoading: false,
    isError: false,
    status: data === undefined ? 'pending' : 'success',
    fetchStatus: 'idle',
    ...extra,
  };
}

function renderPicker(value = '') {
  return render(
    <FieldPicker entity="lead" value={value} onChange={() => undefined} />,
  );
}

function openPicker() {
  fireEvent.click(screen.getByRole('button', { name: PLACEHOLDER }));
}

function revealCatalog() {
  const button = screen.queryByRole('button', { name: PLACEHOLDER });
  if (button) fireEvent.click(button);
}

describe('FieldPicker field catalog', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused field read as a loaded catalog', () => {
    // WHY: a paused first read has isLoading false and no payload. The
    // hard-coded Status row is a settled catalog. The fields have not arrived.
    settle(undefined, { status: 'pending', fetchStatus: 'paused' });
    renderPicker();
    revealCatalog();

    expect(screen.queryByText('Status')).toBeNull();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText('No fields found.')).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not treat an in-flight field read as a loaded catalog', () => {
    // WHY: a slow read also has no payload. The hard-coded schema is not a
    // settled catalog.
    settle(undefined, { isLoading: true, status: 'pending', fetchStatus: 'fetching' });
    renderPicker();
    revealCatalog();

    expect(screen.queryByText('Status')).toBeNull();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText('No fields found.')).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps a failed field read on the error', () => {
    // WHY: a failed read is not evidence of the hard-coded schema. The error
    // stays, and Status does not stand in for a catalog.
    settle(undefined, { isError: true, status: 'error', fetchStatus: 'idle' });
    renderPicker();
    revealCatalog();

    expect(screen.queryByText('Status')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText('No fields found.')).toBeNull();
  });

  it('lets a failed read win over a stale field', () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // showing Status from a payload that is no longer the read.
    settle([STATUS], { isError: true, status: 'error', fetchStatus: 'idle' });
    renderPicker('status');

    expect(screen.queryByText('Status')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Status' })).toBeNull();
  });

  it('stays empty when a settled catalog has no fields', () => {
    // WHY: a catalog that arrived empty stays empty. A slow network must not
    // be dressed up as that outcome, and this one must.
    settle([]);
    renderPicker();
    openPicker();

    expect(screen.getByText('No fields found.')).toBeTruthy();
    expect(screen.queryByText('Status')).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still shows a field when the catalog has arrived', () => {
    // WHY: a loaded field stays. The unread line must not replace a field the
    // read already returned.
    settle([STATUS]);
    renderPicker('status');

    expect(screen.getByRole('button', { name: 'Status' })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

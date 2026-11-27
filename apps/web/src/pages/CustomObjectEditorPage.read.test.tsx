// A paused or in-flight catalog read has no payload yet. The editor said
// "Object not found", which is a settled miss. That read has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import type { CustomObjectDef, CustomObjectDefList } from '@bidstack/shared';

interface DefsSnapshot {
  data?: CustomObjectDefList;
  isLoading: boolean;
  isError: boolean;
  status: string;
  error: Error | null;
  fetchStatus: 'idle' | 'fetching' | 'paused';
  refetch: () => void;
}

const hookMocks = vi.hoisted(() => ({
  defs: {
    data: undefined,
    isLoading: false,
    isError: false,
    status: 'pending',
    error: null,
    fetchStatus: 'idle',
    refetch: vi.fn(),
  } as DefsSnapshot,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
  }),
}));

vi.mock('@/hooks/useCustomObjects', () => ({
  useCustomObjectDefs: () => hookMocks.defs,
  useCustomObjectRelations: () => ({
    data: { items: [] },
    isLoading: false,
    isError: false,
    status: 'success',
  }),
  useCustomObjectFields: () => ({
    data: { items: [] },
    isLoading: false,
    isError: false,
    status: 'success',
  }),
  useUpdateCustomObjectDef: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAddCustomObjectField: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAddCustomObjectRelation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { CustomObjectEditorPage } from './CustomObjectEditorPage';

const OBJECT_ID = '11111111-1111-4111-8111-111111111111';
const CHECKING = 'Checking this object. The record has not arrived.';
const FAILED = "Couldn't load object definitions";
const NOT_FOUND = /Object not found/;

const PLANT: CustomObjectDef = {
  id: OBJECT_ID,
  orgId: '22222222-2222-4222-8222-222222222222',
  key: 'plant',
  labelSingular: 'Plant',
  labelPlural: 'Plants',
  description: null,
  icon: 'box',
  color: '#336699',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  recordCount: 1,
};

function settle(data: CustomObjectDefList | undefined, extra: Partial<DefsSnapshot> = {}) {
  hookMocks.defs = {
    data,
    isLoading: false,
    isError: false,
    status: data === undefined ? 'pending' : 'success',
    error: null,
    fetchStatus: 'idle',
    refetch: vi.fn(),
    ...extra,
  };
}

function renderEditor() {
  return render(
    <MemoryRouter initialEntries={[`/settings/custom-objects/${OBJECT_ID}`]}>
      <Routes>
        <Route path="/settings/custom-objects/:id" element={<CustomObjectEditorPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('CustomObjectEditorPage catalog read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused catalog read as a missing object', () => {
    // WHY: a paused first read has isLoading false and no payload. "Object not
    // found" is a settled miss. The catalog has not arrived.
    settle(undefined, { status: 'pending', fetchStatus: 'paused' });
    renderEditor();

    expect(screen.queryByText('Plant')).toBeNull();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not treat an in-flight catalog read as a missing object', () => {
    // WHY: a slow read also has no payload. The pulse skeleton is not a settled
    // miss, and it is not a failed load.
    settle(undefined, { isLoading: true, status: 'pending', fetchStatus: 'fetching' });
    renderEditor();

    expect(screen.queryByText('Plant')).toBeNull();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps a failed catalog read on the error', () => {
    // WHY: a failed read is not evidence that the object is gone. The error
    // stays, and the missing sentence does not stand in for the catalog.
    settle(undefined, { isError: true, status: 'error', fetchStatus: 'idle' });
    renderEditor();

    expect(screen.queryByText('Plant')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
  });

  it('lets a failed read win over a stale object', () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // showing Plant from a catalog that is no longer the read.
    settle({ items: [PLANT] }, { isError: true, status: 'error', fetchStatus: 'idle' });
    renderEditor();

    expect(screen.queryByText('Plant')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
  });

  it('stays missing when a settled catalog has no such object', () => {
    // WHY: a catalog that arrived without this id stays missing. A slow network
    // must not be dressed up as that outcome, and this one must.
    settle({ items: [] });
    renderEditor();

    expect(screen.getByText(NOT_FOUND)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to list' })).toBeTruthy();
    expect(screen.queryByText('Plant')).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still shows an object when the catalog has arrived', () => {
    // WHY: a loaded object stays. The unread line must not replace a record the
    // catalog already returned.
    settle({ items: [PLANT] });
    renderEditor();

    expect(screen.getByText('Plant')).toBeTruthy();
    expect(screen.getByText('plant')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

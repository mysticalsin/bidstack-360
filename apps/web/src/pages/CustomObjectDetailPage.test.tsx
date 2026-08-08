// Regression coverage for the record-level write gating: PUT/DELETE
// /api/custom-objects/:id/records/:recordId are gated server-side behind
// customObjects:write, but the inline field-edit trigger and Delete button
// rendered enabled unconditionally — a role without the permission saw
// controls that always 403'd on submit.

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { CustomObjectDetailPage } from './CustomObjectDetailPage';
import {
  useCustomObjectDefs,
  useCustomObjectFields,
  useCustomObjectRecord,
} from '@/hooks/useCustomObjects';
import { useHasPermission } from '@/hooks/useCapabilities';

// Real react-i18next (uninitialized in tests) doesn't interpolate {{field}} /
// {{value}} into the t(key, defaultValue, values) fallback — mock it so
// assertions on the rendered aria-labels match what a real user sees.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values[key] ?? ''));
    },
  }),
}));

vi.mock('@/hooks/useCustomObjects', () => ({
  useCustomObjectDefs: vi.fn(),
  useCustomObjectFields: vi.fn(),
  useCustomObjectRecord: vi.fn(),
  useUpdateCustomObjectRecord: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteCustomObjectRecord: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));

// Field edit + delete are gated server-side behind customObjects:write —
// default true so incidental assertions are unaffected; the dedicated
// describe block below overrides per-test.
vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: vi.fn(() => true) }));

const def = {
  id: 'def-1',
  orgId: 'org-1',
  key: 'vendors',
  labelSingular: 'Vendor',
  labelPlural: 'Vendors',
  description: null,
  icon: 'box',
  color: '#6366f1',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const record = {
  id: 'rec-1',
  orgId: 'org-1',
  customObjectDefId: 'def-1',
  recordKey: 'VEN-0001',
  valuesJson: { name: 'Acme Supplies' },
  createdById: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  deletedAt: null,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/o/vendors/rec-1']}>
      <Routes>
        <Route path="/o/:objectKey/:recordId" element={<CustomObjectDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('CustomObjectDetailPage — customObjects:write gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useHasPermission).mockReturnValue(true);
    vi.mocked(useCustomObjectDefs).mockReturnValue({
      data: { items: [def] },
    } as ReturnType<typeof useCustomObjectDefs>);
    vi.mocked(useCustomObjectFields).mockReturnValue({
      data: { items: [] },
    } as ReturnType<typeof useCustomObjectFields>);
    vi.mocked(useCustomObjectRecord).mockReturnValue({
      data: record,
      isLoading: false,
    } as ReturnType<typeof useCustomObjectRecord>);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders an enabled Delete and field-edit trigger for a role with customObjects:write', () => {
    vi.mocked(useHasPermission).mockReturnValue(true);

    renderPage();

    const deleteButton = screen.getByRole('button', { name: 'Delete' });
    expect(deleteButton.hasAttribute('disabled')).toBe(false);
    const editTrigger = screen.getByRole('button', { name: /Edit name: Acme Supplies/i });
    expect(editTrigger.hasAttribute('disabled')).toBe(false);
  });

  it('disables Delete and the field-edit trigger with a hint for a role without customObjects:write', () => {
    vi.mocked(useHasPermission).mockReturnValue(false);

    renderPage();

    // The record still renders (read access is ungated) ...
    expect(screen.getByRole('heading', { name: 'Acme Supplies' })).toBeTruthy();
    // ... but the write affordances are disabled, not just visually muted,
    // so they can't 403 on submit.
    const deleteButton = screen.getByRole('button', { name: 'Delete' });
    expect(deleteButton.hasAttribute('disabled')).toBe(true);
    expect(deleteButton.getAttribute('title')).toMatch(/customObjectDetail\.readOnlyHint|write access/i);

    const editTrigger = screen.getByRole('button', { name: /Edit name: Acme Supplies/i });
    expect(editTrigger.hasAttribute('disabled')).toBe(true);
  });
});

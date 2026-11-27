// Regression coverage for the record-level write gating: PUT/DELETE
// /api/custom-objects/:id/records/:recordId are gated server-side behind
// customObjects:write, but the inline field-edit trigger and Delete button
// rendered enabled unconditionally — a role without the permission saw
// controls that always 403'd on submit.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from 'react-router-dom';

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
    const deleteButton = screen.getByRole('button', { name: /^Delete/ });
    expect(deleteButton.hasAttribute('disabled')).toBe(true);
    expect(deleteButton.getAttribute('title')).toMatch(/customObjectDetail\.readOnlyHint|write access/i);
    // `title` is mouse-only — the accessible name itself must carry the
    // reason so screen-reader/keyboard users get it too.
    expect(deleteButton.getAttribute('aria-label')).toMatch(/write access/i);

    const editTrigger = screen.getByRole('button', { name: /Edit name: Acme Supplies/i });
    expect(editTrigger.hasAttribute('disabled')).toBe(true);
    expect(editTrigger.getAttribute('aria-label')).toMatch(/write access/i);
  });
});

describe('CustomObjectDetailPage — defined fields on an empty record', () => {
  beforeEach(() => {
    vi.mocked(useHasPermission).mockReturnValue(true);
    vi.mocked(useCustomObjectDefs).mockReturnValue({
      data: { items: [def] },
    } as ReturnType<typeof useCustomObjectDefs>);
  });

  afterEach(() => {
    cleanup();
  });

  function renderBlank() {
    vi.mocked(useCustomObjectRecord).mockReturnValue({
      data: { ...record, valuesJson: {} },
      isLoading: false,
    } as ReturnType<typeof useCustomObjectRecord>);
    return renderPage();
  }

  it('lists the catalog when the record has no stored values, instead of sending the reader to define fields', () => {
    // A record created from the list only stores the keys it was given. The
    // object still has its fields (Name, Owner). An empty valuesJson is not
    // "no fields defined", and a blank field has to stay editable.
    vi.mocked(useCustomObjectFields).mockReturnValue({
      data: {
        items: [
          { fieldKey: 'name', label: 'Name', fieldType: 'text', options: null },
          { fieldKey: 'owner', label: 'Owner', fieldType: 'text', options: null },
        ],
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useCustomObjectFields>);

    renderBlank();

    expect(screen.queryByText(/No fields defined yet/)).toBeNull();
    expect(screen.getByText('Owner')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Edit Owner/i }).hasAttribute('disabled')).toBe(false);
  });

  it('does not claim the catalog is empty while the field read is still loading', () => {
    vi.mocked(useCustomObjectFields).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    } as ReturnType<typeof useCustomObjectFields>);

    renderBlank();

    expect(screen.queryByText(/No fields defined yet/)).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Loading fields.');
  });

  it('does not claim the catalog is empty when the field read failed', () => {
    vi.mocked(useCustomObjectFields).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as ReturnType<typeof useCustomObjectFields>);

    renderBlank();

    expect(screen.queryByText(/No fields defined yet/)).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Could not load fields.');
  });

  it('keeps a stored value the catalog does not list', () => {
    vi.mocked(useCustomObjectFields).mockReturnValue({
      data: {
        items: [{ fieldKey: 'name', label: 'Name', fieldType: 'text', options: null }],
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useCustomObjectFields>);
    vi.mocked(useCustomObjectRecord).mockReturnValue({
      data: { ...record, valuesJson: { name: 'Acme Supplies', legacy_note: 'Keep me' } },
      isLoading: false,
    } as ReturnType<typeof useCustomObjectRecord>);

    renderPage();

    expect(screen.getByText('Name')).toBeTruthy();
    expect(screen.getByText('Keep me')).toBeTruthy();
  });

  it('still says no fields are defined when the catalog and the record are both empty', () => {
    vi.mocked(useCustomObjectFields).mockReturnValue({
      data: { items: [] },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useCustomObjectFields>);

    renderBlank();

    expect(screen.getByText(/No fields defined yet/)).toBeTruthy();
  });
});

describe('CustomObjectDetailPage — edit draft follows the record in the URL', () => {
  afterEach(() => {
    cleanup();
  });

  it('drops an in-progress edit when the route opens a different record', async () => {
    // /o/:objectKey/:recordId keeps this page mounted. The draft is local
    // state, so opening the next record must not keep the previous value in
    // the field that Save would write.
    vi.mocked(useHasPermission).mockReturnValue(true);
    vi.mocked(useCustomObjectDefs).mockReturnValue({
      data: { items: [def] },
    } as ReturnType<typeof useCustomObjectDefs>);
    vi.mocked(useCustomObjectFields).mockReturnValue({
      data: { items: [] },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useCustomObjectFields>);

    let shown = record;
    vi.mocked(useCustomObjectRecord).mockImplementation(
      () =>
        ({
          data: shown,
          isLoading: false,
        }) as ReturnType<typeof useCustomObjectRecord>,
    );

    const router = createMemoryRouter(
      [{ path: '/o/:objectKey/:recordId', element: <CustomObjectDetailPage /> }],
      { initialEntries: ['/o/vendors/rec-1'] },
    );
    render(<RouterProvider router={router} />);

    fireEvent.click(screen.getByRole('button', { name: /Edit name: Acme Supplies/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /Edit name/i }), {
      target: { value: 'Not Acme' },
    });

    shown = {
      ...record,
      id: 'rec-2',
      recordKey: 'VEN-0002',
      valuesJson: { name: 'Northwind' },
    };
    await act(async () => {
      await router.navigate('/o/vendors/rec-2');
    });

    expect(screen.queryByDisplayValue('Not Acme')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Northwind' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Edit name: Northwind/i })).toBeTruthy();
  });
});

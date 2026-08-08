// Regression coverage for record-create write gating: POST
// /api/custom-objects/:id/records is gated server-side behind
// customObjects:write, but the page rendered the "New <object>" button/form
// unconditionally — a role without the permission saw a button that always
// 403'd on submit.

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { CustomObjectListPage } from './CustomObjectListPage';
import {
  useCustomObjectDefs,
  useCustomObjectRecords,
} from '@/hooks/useCustomObjects';
import { useHasPermission } from '@/hooks/useCapabilities';

// Real react-i18next (uninitialized in tests) doesn't interpolate {{label}}
// into the t(key, defaultValue, values) fallback — mock it so assertions on
// the rendered "New Vendor" text match what a real user sees.
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
  useCustomObjectRecords: vi.fn(),
  useCreateCustomObjectRecord: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));

// Record creation is gated server-side behind customObjects:write — default
// true so any incidental rendering assertions aren't affected; the dedicated
// describe block below overrides per-test.
vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: vi.fn(() => true) }));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

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
  recordCount: 0,
};

function renderPage() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/o/vendors']}>
        <Routes>
          <Route path="/o/:objectKey" element={<CustomObjectListPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CustomObjectListPage — customObjects:write gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useHasPermission).mockReturnValue(true);
    vi.mocked(useCustomObjectDefs).mockReturnValue({
      data: { items: [def] },
      isLoading: false,
    } as ReturnType<typeof useCustomObjectDefs>);
    vi.mocked(useCustomObjectRecords).mockReturnValue({
      data: { items: [], total: 0 },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useCustomObjectRecords>);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the "New <object>" button for a role with customObjects:write', () => {
    vi.mocked(useHasPermission).mockReturnValue(true);

    renderPage();

    expect(screen.getByRole('button', { name: /New Vendor/i })).toBeTruthy();
  });

  it('hides the "New <object>" button for a role without customObjects:write', () => {
    vi.mocked(useHasPermission).mockReturnValue(false);

    renderPage();

    // The list itself still renders (read access is ungated) ...
    expect(screen.getByText('Vendors')).toBeTruthy();
    // ... but the write affordance that would 403 on submit is gone.
    expect(screen.queryByRole('button', { name: /New Vendor/i })).toBeNull();
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SalesToolkit } from '@bidstack/shared';

const storeHookMocks = vi.hoisted(() => ({
  useSalesToolkitStore: vi.fn(),
  useCreateToolkit: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateToolkit: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useDeleteToolkit: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useImportSharePoint: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));
vi.mock('@/hooks/useSalesToolkitStore', () => storeHookMocks);

const hasPermission = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: hasPermission }));

import { ToolkitStoreSection } from './ToolkitStoreSection';

function baseToolkit(): SalesToolkit {
  return {
    id: 'tk-1',
    title: 'Discovery deck',
    description: null,
    category: 'deck',
    sectorTags: [],
    url: null,
    source: 'manual',
    externalId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function mockStore() {
  storeHookMocks.useSalesToolkitStore.mockReturnValue({
    data: { items: [baseToolkit()] },
    isLoading: false,
    isError: false,
    error: null,
  });
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToolkitStoreSection />
    </QueryClientProvider>,
  );
}

// The backend requires documents:write on POST/PATCH/DELETE/import-sharepoint
// (apps/api/src/routes/sales-toolkits.ts) but that permission is only granted
// to Admin and Presales (packages/db/src/seed.rbac.ts). Every other role must
// never see controls that would 403 with no feedback on click.
describe('ToolkitStoreSection — RBAC-gated write controls', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('hides Add/Import/Edit/Delete controls for a role without documents:write', () => {
    hasPermission.mockReturnValue(false);
    mockStore();

    renderSection();

    expect(screen.queryByRole('button', { name: /Add toolkit/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Import from SharePoint/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit Discovery deck' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete Discovery deck' })).toBeNull();
  });

  it('shows Add/Import/Edit/Delete controls for a role with documents:write', () => {
    hasPermission.mockReturnValue(true);
    mockStore();

    renderSection();

    expect(screen.getByRole('button', { name: /Add toolkit/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Import from SharePoint/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit Discovery deck' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete Discovery deck' })).toBeTruthy();
  });
});

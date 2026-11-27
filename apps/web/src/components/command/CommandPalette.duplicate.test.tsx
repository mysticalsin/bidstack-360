// ⌘K listed CI Financial twice: once from the dashboard snapshot and again
// from workspace search (account:<id> and search:company:<id>). Both rows
// open /accounts/<id>. The second row is the same key account.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import type { CrmCompany } from '@bidstack/shared';

import { CommandPalette } from './CommandPalette';
import { api } from '@/lib/api';

const CI = 'c0000000-0000-4000-8000-000000000001';

function company(): CrmCompany {
  return {
    id: CI,
    source: 'external_crm',
    name: 'CI Financial',
    legalName: 'CI Financial Corp.',
    domain: 'ci.com',
    website: null,
    industry: 'financial_services',
    employeeCount: null,
    annualRevenueMicros: null,
    status: null,
    registryIds: {},
    formerNames: [],
    incorporationDate: null,
    logo: null,
    confidence: 1,
    sourceAttribution: [],
    updatedAt: '2026-05-11T00:00:00.000Z',
  };
}

vi.mock('@/hooks/useCrmDashboard', () => ({
  useCrmDashboard: () => ({ data: { companies: [company()] } }),
}));

vi.mock('@/hooks/useContacts', () => ({
  useContacts: () => ({ data: { items: [] } }),
}));

vi.mock('@/hooks/useTasks', () => ({
  useTasks: () => ({ data: { items: [] } }),
}));

vi.mock('@/components/company/CompanyLogo', () => ({
  CompanyLogo: ({ name }: { name: string }) => <span>{name}</span>,
}));

vi.mock('@/lib/api', () => ({
  api: vi.fn(async () => ({ items: [] })),
}));

vi.mock('@/hooks/useAppModules', () => ({
  useAppModules: () => ({ data: undefined }),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: () => false,
}));

function renderPalette() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CommandPalette open onOpenChange={() => undefined} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function rowsNamed(name: string): HTMLElement[] {
  return screen.getAllByRole('option').filter((option) => option.textContent?.includes(name));
}

afterEach(() => {
  cleanup();
  vi.mocked(api).mockImplementation(async () => ({ items: [] }));
});

describe('CommandPalette duplicate records', () => {
  it('shows the demo key account once after workspace search returns it too', async () => {
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (String(path).startsWith('/api/search')) {
        return {
          items: [
            {
              id: CI,
              type: 'company',
              title: 'CI Financial',
              subtitle: 'ci.com · financial_services',
              url: `/accounts/${CI}`,
              score: 12,
            },
            {
              id: 'note-mahle',
              type: 'note',
              title: 'Sample: MAHLE test bench review',
              subtitle: 'MAHLE',
              url: '/accounts/c0000000-0000-4000-8000-000000000005',
              score: 1,
            },
          ],
          pageContinues: false,
          continuedTypes: [],
          query: 'CI Financial',
        };
      }
      return { items: [] };
    });

    renderPalette();
    const input = screen.getByRole('combobox', { name: /search across the workspace/i });
    fireEvent.change(input, { target: { value: 'CI Financial' } });

    // The note exists only in workspace search. Seeing it means that payload
    // has been merged, so a second CI Financial row would be on screen too.
    await screen.findByRole('option', { name: /Sample: MAHLE test bench review/ });
    await waitFor(() => {
      expect(rowsNamed('CI Financial')).toHaveLength(1);
    });
    expect(rowsNamed('Sample: MAHLE test bench review')).toHaveLength(1);
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { CommandPalette } from './CommandPalette';
import type { CrmCompany } from '@bidstack/shared';

// Minimal company fixtures — only the fields the palette actually reads. The
// rest of CrmCompany is exercised by the schema's own tests.
function company(overrides: Partial<CrmCompany>): CrmCompany {
  return {
    id: overrides.id ?? 'co_test',
    source: 'twenty',
    name: overrides.name ?? 'Test Co',
    legalName: overrides.legalName ?? null,
    domain: overrides.domain ?? null,
    website: null,
    industry: overrides.industry ?? null,
    employeeCount: null,
    annualRevenueMicros: null,
    status: null,
    registryIds: {},
    formerNames: [],
    incorporationDate: null,
    logo: null,
    confidence: 1,
    sourceAttribution: [],
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const COMPANIES: CrmCompany[] = [
  company({ id: 'co_aritzia', name: 'Aritzia', industry: 'Retail', domain: 'aritzia.com' }),
  company({ id: 'co_lulu', name: 'Lululemon', industry: 'Apparel', domain: 'lululemon.com' }),
  company({ id: 'co_canada-goose', name: 'Canada Goose', industry: 'Apparel' }),
];

vi.mock('@/hooks/useCrmDashboard', () => ({
  useCrmDashboard: () => ({ data: { companies: COMPANIES } }),
}));

// The palette also pulls contacts + tasks for cross-entity search; mock those
// with empty arrays so the assertions only see the account row.
vi.mock('@/hooks/useContacts', () => ({
  useContacts: () => ({ data: { items: [] } }),
}));
vi.mock('@/hooks/useTasks', () => ({
  useTasks: () => ({ data: { items: [] } }),
}));

// CompanyLogo would otherwise try to render <img>, which is noisy in jsdom but
// not strictly broken — we stub it to keep the test focused on palette logic.
vi.mock('@/components/company/CompanyLogo', () => ({
  CompanyLogo: ({ name }: { name: string }) => <span data-testid="company-logo">{name}</span>,
}));

vi.mock('@/lib/api', () => ({
  api: vi.fn(async () => ({ items: [] })),
}));

function renderPalette() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <CommandPalette open={true} onOpenChange={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CommandPalette — accounts section', () => {
  it('filters companies by name when the user types a substring', () => {
    renderPalette();

    const input = screen.getByRole('searchbox', { name: /search across the crm/i });
    fireEvent.change(input, { target: { value: 'ari' } });

    // The Aritzia row is the only listbox option after filtering by "ari".
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]?.textContent).toContain('Aritzia');
    expect(options[0]?.textContent).toContain('Retail · aritzia.com');

    // Non-matching companies are filtered out — verifies the substring match
    // actually narrows the list rather than always rendering everything.
    expect(screen.queryByText('Lululemon')).toBeNull();
    expect(screen.queryByText('Canada Goose')).toBeNull();
  });
});

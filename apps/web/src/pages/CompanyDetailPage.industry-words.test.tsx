import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CompanyDetail } from '@bidstack/shared';

import { useCompany, useCompanyHierarchy } from '@/hooks/useCompanies';

import { CompanyDetailPage } from './CompanyDetailPage';

// The company header badge printed the stored code. CI Financial is
// financial_services. The overview should say Financial Services. Edit
// details still holds the code, so a save does not rename the industry.
vi.mock('@/hooks/useCompanies', () => ({
  useCompany: vi.fn(),
  useCompanyHierarchy: vi.fn(() => ({ isLoading: false, isError: false, data: undefined })),
  useUpdateCompany: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: vi.fn(() => false),
  useHasAdminPermission: vi.fn(() => true),
}));

vi.mock('@/hooks/useCompanyIntelSummary', () => ({
  useCompanyIntelSummary: vi.fn(() => ({ data: undefined })),
  useRefreshCompanyIntel: vi.fn(() => ({ mutate: vi.fn(), isPending: false, pollUntil: null })),
}));

vi.mock('@/components/company/AccountActivityCharts', () => ({ AccountActivityCharts: () => null }));
vi.mock('@/components/company/AccountTeamCard', () => ({ AccountTeamCard: () => null }));
vi.mock('@/components/company/AccountConversations', () => ({ AccountConversations: () => null }));
vi.mock('@/components/company/CompanyTechStackSection', () => ({ CompanyTechStackSection: () => null }));
vi.mock('@/components/consulting-partners/ConsultingPartnersSection', () => ({
  ConsultingPartnersSection: () => null,
}));
vi.mock('@/components/email/EmailPanel', () => ({ EmailPanel: () => null }));
vi.mock('@/components/CustomFieldValuesSection', () => ({ CustomFieldValuesSection: () => null }));
vi.mock('@/components/company/FollowAccountButton', () => ({ FollowAccountButton: () => null }));

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';

function company(industry: string | null): CompanyDetail {
  return {
    id: COMPANY_ID,
    orgId: '22222222-2222-4222-8222-222222222222',
    name: 'CI Financial',
    legalName: 'CI Financial',
    domain: 'ci.com',
    industry,
    employeeCount: 2500,
    countryCode: 'CA',
    address: null,
    billingEmail: null,
    taxId: null,
    logoUrl: null,
    website: 'https://ci.com/',
    source: 'verified_data',
    confidence: 0.72,
    enrichedAt: '2026-01-01T00:00:00.000Z',
    tier: 'key',
    parentId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    contacts: [],
    opportunities: [],
    openCases: [],
    notes: [],
    parent: null,
    children: [],
  };
}

function renderDetail(industry: string | null) {
  vi.mocked(useCompany).mockReturnValue({
    data: company(industry),
    isLoading: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useCompany>);
  vi.mocked(useCompanyHierarchy).mockReturnValue({
    isLoading: false,
    isError: false,
    data: undefined,
  } as unknown as ReturnType<typeof useCompanyHierarchy>);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/companies/${COMPANY_ID}`]}>
        <Routes>
          <Route path="/companies/:id" element={<CompanyDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CompanyDetailPage industry words', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('says Financial Services on the overview and keeps the stored code in the editor', () => {
    renderDetail('financial_services');

    expect(screen.getByText('Financial Services')).toBeTruthy();
    expect(screen.queryByText('financial_services')).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'Edit details' }));

    expect(screen.getByLabelText('Industry')).toHaveProperty('value', 'financial_services');
  });

  it('says Pharmaceuticals for a one-word demo code', () => {
    renderDetail('pharmaceuticals');

    expect(screen.getByText('Pharmaceuticals')).toBeTruthy();
    expect(screen.queryByText('pharmaceuticals')).toBeNull();
  });

  it('does not invent an industry badge when the company has none', () => {
    renderDetail(null);

    expect(screen.getByRole('heading', { name: 'CI Financial' })).toBeTruthy();
    expect(screen.queryByText('Financial Services')).toBeNull();
    expect(screen.queryByText('null')).toBeNull();
  });
});

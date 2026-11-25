// A company record and its account cockpit share one id, but they are different
// pages. From CI Financial's company record the bids and contacts are here,
// and the pipeline, risks, and win rate are on /accounts/:id. Without a link,
// the record is a dead end: the only way back to that cockpit is to leave and
// hunt the accounts list. This fails if the header stops pointing at the cockpit.
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CompanyDetail } from '@bidstack/shared';

import { CompanyDetailPage } from './CompanyDetailPage';

const COMPANY_ID = '00000000-0000-4000-8000-0000000000c1';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) => {
      const template = fallback ?? key;
      if (!values) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(values[name] ?? ''));
    },
  }),
}));

const companyState = vi.hoisted(() => ({
  mode: 'ready' as 'ready' | 'error',
}));

const COMPANY: CompanyDetail = {
  id: COMPANY_ID,
  orgId: '00000000-0000-4000-8000-0000000000aa',
  name: 'CI Financial',
  legalName: 'CI Financial Corp',
  domain: 'ci.example',
  industry: 'financial_services',
  employeeCount: 2500,
  countryCode: 'CA',
  address: null,
  billingEmail: null,
  taxId: null,
  logoUrl: null,
  website: null,
  source: 'crm',
  confidence: 1,
  enrichedAt: null,
  tier: 'key',
  parentId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
  contacts: [],
  opportunities: [],
  openCases: [],
  notes: [],
  parent: null,
  children: [],
};

vi.mock('@/hooks/useCompanies', () => ({
  useCompany: () =>
    companyState.mode === 'error'
      ? { isLoading: false, isError: true, data: undefined, error: new Error('down') }
      : { isLoading: false, isError: false, data: COMPANY, error: null },
  useCompanyHierarchy: () => ({ isLoading: false, isError: false, data: undefined }),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: () => false,
}));

vi.mock('@/hooks/useCompanyIntelSummary', () => ({
  useCompanyIntelSummary: () => ({ data: undefined }),
  useRefreshCompanyIntel: () => ({ mutate: vi.fn(), isPending: false, pollUntil: null }),
}));

vi.mock('@/components/company/FollowAccountButton', () => ({ FollowAccountButton: () => null }));
vi.mock('@/components/company/AccountActivityCharts', () => ({ AccountActivityCharts: () => null }));
vi.mock('@/components/company/AccountTeamCard', () => ({ AccountTeamCard: () => null }));
vi.mock('@/components/company/AccountConversations', () => ({ AccountConversations: () => null }));
vi.mock('@/components/company/CompanyTechStackSection', () => ({
  CompanyTechStackSection: () => null,
}));
vi.mock('@/components/consulting-partners/ConsultingPartnersSection', () => ({
  ConsultingPartnersSection: () => null,
}));
vi.mock('@/components/email/EmailPanel', () => ({ EmailPanel: () => null }));
vi.mock('@/components/CustomFieldValuesSection', () => ({ CustomFieldValuesSection: () => null }));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/companies/${COMPANY_ID}`]}>
        <Routes>
          <Route path="/companies/:id" element={<CompanyDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  companyState.mode = 'ready';
  localStorage.clear();
});

describe('Company record opens its account cockpit', () => {
  it('links CI Financial to the cockpit for that same company id', () => {
    renderPage();

    const link = screen.getByRole('link', { name: 'Open account cockpit' });
    expect(link.getAttribute('href')).toBe(`/accounts/${COMPANY_ID}`);
  });

  it('does not offer a cockpit when the company record did not load', () => {
    companyState.mode = 'error';
    renderPage();

    expect(screen.queryByRole('link', { name: 'Open account cockpit' })).toBeNull();
    expect(screen.getByText("Couldn't load company")).toBeTruthy();
  });
});

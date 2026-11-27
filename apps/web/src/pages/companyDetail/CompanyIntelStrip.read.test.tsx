import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { intelSummary } from '../companiesPage/__fixtures__/intel-summary';

const intel: { current: { data: unknown; isError: boolean; isLoading: boolean } } = {
  current: { data: undefined, isError: false, isLoading: false },
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('@/hooks/useCompanies', () => ({
  useCompany: () => ({
    isLoading: false,
    isError: false,
    data: {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Northwind Pharma',
      legalName: null,
      domain: 'northwind-pharma.example',
      countryCode: 'FR',
      employeeCount: 4200,
      taxId: null,
      parent: null,
      contacts: [],
      opportunities: [],
      openCases: [],
      notes: [],
      children: [],
    },
  }),
  useCompanyHierarchy: () => ({ data: undefined, isLoading: false, isError: false }),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: () => true,
}));

vi.mock('@/hooks/useCompanyIntelSummary', () => ({
  useCompanyIntelSummary: () => ({ ...intel.current, refetch: vi.fn() }),
  useRefreshCompanyIntel: () => ({ mutate: vi.fn(), isPending: false, pollUntil: undefined }),
}));

vi.mock('@/components/company/AccountActivityCharts', () => ({ AccountActivityCharts: () => null }));
vi.mock('@/components/company/AccountTeamCard', () => ({ AccountTeamCard: () => null }));
vi.mock('@/components/company/AccountConversations', () => ({ AccountConversations: () => null }));
vi.mock('@/components/company/CompanyTechStackSection', () => ({ CompanyTechStackSection: () => null }));
vi.mock('@/components/company/CompanyLogo', () => ({ CompanyLogo: () => null }));
vi.mock('@/components/company/FollowAccountButton', () => ({ FollowAccountButton: () => null }));
vi.mock('@/components/consulting-partners/ConsultingPartnersSection', () => ({
  ConsultingPartnersSection: () => null,
}));
vi.mock('@/components/email/EmailPanel', () => ({ EmailPanel: () => null }));
vi.mock('@/components/CustomFieldValuesSection', () => ({ CustomFieldValuesSection: () => null }));
vi.mock('@/components/company-intel/AccountDirectionSection', () => ({
  AccountDirectionSection: () => null,
}));

import { CompanyDetailPage } from '../CompanyDetailPage';

const ID = '11111111-1111-4111-8111-111111111111';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/companies/${ID}`]}>
      <Routes>
        <Route path="/companies/:id" element={<CompanyDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('company intel strip waits for the read', () => {
  it.each([false, true])('does not call an unread summary "not refreshed" (loading %s)', (isLoading) => {
    // WHY: the header used data?.summary ?? null, so a paused read (isLoading
    // false) and an in-flight read both drew the empty gaps. A demo account
    // then looks like it has no intel.
    intel.current = { data: undefined, isError: false, isLoading };
    renderPage();
    expect(screen.queryAllByLabelText(/Not refreshed yet/)).toHaveLength(0);
    expect(screen.getByText('Checking company intel')).toBeTruthy();
  });

  it('keeps the empty gaps when the summary has settled empty', () => {
    intel.current = { data: { summary: null }, isError: false, isLoading: false };
    renderPage();
    expect(screen.getAllByText('\u2013').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/Not refreshed yet/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the loaded figures, including a zero open-role count', () => {
    intel.current = {
      data: { summary: intelSummary({ openRoles: { ...intelSummary().openRoles!, value: 0 } }) },
      isError: false,
      isLoading: false,
    };
    renderPage();
    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.getByText('2.4bn EUR')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says the intel failed to load and does not keep the empty gaps', () => {
    intel.current = { data: undefined, isError: true, isLoading: false };
    renderPage();
    expect(screen.getByRole('alert').textContent).toBe("Couldn't load company intel");
    expect(screen.queryByLabelText(/Not refreshed yet/)).toBeNull();
  });
});

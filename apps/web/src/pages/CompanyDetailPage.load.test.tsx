// A demo link to CI Financial (c0000000-0000-4000-8000-000000000001) that this
// org does not have comes back 404. That is a missing company, and the page
// already has a not-found state, but isError returns first, so the seller
// sees a load failure and the only exit is history.back(). A pasted company
// URL has no history, so that button goes nowhere. Any other failure still
// needs a retry, and must not pretend the company is missing.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api';

import { CompanyDetailPage } from './CompanyDetailPage';
import { useCompany } from '@/hooks/useCompanies';

const CI_FINANCIAL = 'c0000000-0000-4000-8000-000000000001';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: () => false,
  useHasAdminPermission: () => false,
}));

vi.mock('@/hooks/useCompanies', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useCompanies')>('@/hooks/useCompanies');
  return {
    ...actual,
    useCompany: vi.fn(),
    useCompanyHierarchy: vi.fn(() => ({ isLoading: false, isError: false, data: undefined })),
  };
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/companies/${CI_FINANCIAL}`]}>
        <Routes>
          <Route path="/companies/:id" element={<CompanyDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CompanyDetailPage load states', () => {
  it('says a 404 company is missing and links to the companies list', () => {
    vi.mocked(useCompany).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError('Company not found', 404, null),
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useCompany>);

    renderPage();

    expect(screen.getByRole('heading', { name: 'Company not found' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: "Couldn't load company" })).toBeNull();
    const back = screen.getByRole('link', { name: 'Back to companies' });
    expect(back.getAttribute('href')).toBe('/companies');
    expect(back.className).toMatch(/min-h-11/);
    expect(back.className).toMatch(/focus-visible:ring-2/);
    expect(screen.queryByRole('button', { name: 'Go back' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('offers a retry when the company read fails for any other reason', () => {
    const refetch = vi.fn();
    vi.mocked(useCompany).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError('Server error', 500, null),
      refetch,
    } as unknown as ReturnType<typeof useCompany>);

    renderPage();

    expect(screen.getByRole('heading', { name: "Couldn't load company" })).toBeTruthy();
    expect(screen.getByText('The company record did not load. Try again.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Company not found' })).toBeNull();
    expect(screen.queryByText('Server error')).toBeNull();
    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(retry.className).toMatch(/h-11/);
    fireEvent.click(retry);
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('keeps the skeleton while CI Financial is still loading', () => {
    vi.mocked(useCompany).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useCompany>);

    renderPage();

    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Company not found' })).toBeNull();
    expect(screen.queryByRole('heading', { name: "Couldn't load company" })).toBeNull();
  });
});

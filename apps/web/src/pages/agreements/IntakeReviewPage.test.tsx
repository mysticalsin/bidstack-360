import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { extractMsaFields, SYNTHETIC_NORTHWIND_MSA_TEXT } from '@bidstack/shared';

vi.mock('@/hooks/useMsaIntake', () => ({
  useMsaIntakeDraft: vi.fn(),
  useConfirmMsaIntake: vi.fn(),
}));
vi.mock('@/hooks/useCompanies', () => ({
  useCompanies: () => ({
    data: { items: [{ id: 'c0000000-0000-4000-8000-0000000000aa', name: 'Northwind Pharma' }] },
  }),
}));
vi.mock('@/hooks/useSigningEntities', () => ({
  useSigningEntities: () => ({
    data: {
      items: [
        {
          id: 'e0000000-0000-4000-8000-0000000000aa',
          slug: 'hema',
          name: 'HEMA',
          verificationStatus: 'verified',
        },
      ],
    },
  }),
}));

import { useConfirmMsaIntake, useMsaIntakeDraft } from '@/hooks/useMsaIntake';

import IntakeReviewPage, { formatExtractedMicros } from './IntakeReviewPage';

afterEach(cleanup);

describe('IntakeReviewPage', () => {
  it('highlights extracted terms, offers create-new-account, and confirms', async () => {
    const confirm = vi.fn(async () => ({ contractId: 'a0000000-0000-4000-8000-0000000000aa', companyId: 'c0000000-0000-4000-8000-0000000000aa', createdCompany: false }));
    vi.mocked(useConfirmMsaIntake).mockReturnValue({ mutateAsync: confirm, isPending: false } as never);
    vi.mocked(useMsaIntakeDraft).mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        id: 'd0000000-0000-4000-8000-0000000000aa',
        status: 'pending_review',
        fileName: 'northwind-msa.pdf',
        contentType: 'application/pdf',
        bytes: 12,
        sha256: 'a'.repeat(64),
        needsOcr: false,
        usedLlm: false,
        pageCount: 1,
        extractedFields: extractMsaFields(SYNTHETIC_NORTHWIND_MSA_TEXT),
        accountMatches: [
          {
            companyId: 'c0000000-0000-4000-8000-0000000000aa',
            name: 'Northwind Pharma',
            legalName: 'Northwind Pharma SAS',
            domain: 'northwind-pharma.example',
            scoreBps: 9000,
            reasons: ['name'],
          },
        ],
        signingEntityMatches: [{ entityId: 'e0000000-0000-4000-8000-0000000000aa', slug: 'hema', name: 'HEMA', scoreBps: 9500, alias: 'HEMA', reasons: ['alias'] }],
        warnings: ['Missing values stay blank. Nothing is saved until you confirm.'],
        confirmedContractId: null,
        createdAt: new Date().toISOString(),
      },
    } as never);

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/agreements/intake/d0000000-0000-4000-8000-0000000000aa']}>
          <Routes>
            <Route path="/agreements/intake/:id" element={<IntakeReviewPage />} />
            <Route path="/agreements/:id" element={<div data-testid="saved">saved</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('msa-intake-review')).toBeTruthy();
    expect(screen.getAllByText(/Northwind Pharma/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Detected HEMA/i)).toBeTruthy();
    fireEvent.click(screen.getByTestId('msa-review-confirm'));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(document.body.textContent).not.toMatch(/[\u2014]/);
  });

  it('prints a contract cent and refuses an unsafe amount', () => {
    // WHY: dividing micros by 1e6 showed 250,000.5 and 333.333 on the review.
    expect(formatExtractedMicros(250_000_500_000)).toBe('250,000.50');
    expect(formatExtractedMicros(333_333_333)).toBe('333.33');
    expect(formatExtractedMicros(Number.MAX_SAFE_INTEGER + 2)).toBe('amount not readable');
  });
});

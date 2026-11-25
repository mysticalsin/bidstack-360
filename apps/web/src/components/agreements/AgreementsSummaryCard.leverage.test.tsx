import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MsaLeverageFlag } from '@bidstack/shared';

import { AgreementsSummaryCard } from './AgreementsSummaryCard';

// WHY: Demo Northwind Pharma has an active HEMA MSA and no IT pipeline. The
// account agreements card loads that summary and the leverage read separately.
// A failed leverage read currently leaves the flag off, so the card looks like
// an ordinary agreement with no HEMA opportunity. A later refresh failure must
// keep the headline. A finished read with no flag, and the Sample preview
// (MSA routes missing), must not offer a Retry that cannot mean a new read.

const COMPANY = 'c0000000-0000-4000-8000-0000000000aa';
const MSA = 'a0000000-0000-4000-8000-0000000000aa';
const HEADLINE = 'MSA in place via HEMA, no IT business yet: use the existing MSA to enter IT';

const summaryState: { current: unknown } = { current: null };
const leverageState: { current: unknown } = { current: null };

vi.mock('@/hooks/useMsa', () => ({
  useMsaAccountSummary: () => summaryState.current,
}));

vi.mock('@/hooks/useMsaLeverage', () => ({
  useMsaLeverage: () => leverageState.current,
}));

function liveSummary(sample = false) {
  return {
    isLoading: false,
    isError: false,
    data: {
      sample,
      data: {
        total: 1,
        byStatus: { active: 1 },
        childCounts: { sow: 0, amendment: 0, addendum: 0 },
        primary: { id: MSA, title: 'HEMA master services agreement', status: 'active' },
        nextExpiry: null,
        nextNoticeDeadline: null,
        agreementsContinue: false,
      },
    },
  };
}

function hemaFlag(): MsaLeverageFlag {
  return {
    companyId: COMPANY,
    companyName: 'Northwind Pharma',
    msaId: MSA,
    msaTitle: 'HEMA master services agreement',
    signingEntity: {
      id: 'e0000000-0000-4000-8000-000000000001',
      slug: 'hema',
      name: 'HEMA',
      brandFamily: 'amaris',
      businessLines: ['pharma', 'health_economics'],
      verificationStatus: 'verified',
    },
    coveredLines: ['health_economics'],
    missingLines: ['it', 'engineering', 'digital'],
    headline: HEADLINE,
    scopeAllowsOtherServices: false,
    scopeNeedsAmendment: true,
    scopeCitation: null,
  };
}

function renderCard() {
  return render(
    <MemoryRouter>
      <AgreementsSummaryCard companyId={COMPANY} companyName="Northwind Pharma" />
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('Agreements summary card leverage read', () => {
  it('says the leverage read failed instead of showing an agreement with no HEMA flag', () => {
    const refetch = vi.fn();
    summaryState.current = liveSummary(false);
    leverageState.current = { isLoading: false, isError: true, data: undefined, refetch };
    renderCard();

    const card = screen.getByTestId('account-agreements-card');
    expect(card.textContent).toContain('HEMA master services agreement');
    expect(card.textContent).toContain('Could not load the MSA leverage read.');
    expect(card.textContent).not.toContain(HEADLINE);
    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(retry.className).toContain('min-h-11');
    expect(retry.className).toContain('focus-visible:ring-2');
    fireEvent.click(retry);
    expect(refetch).toHaveBeenCalledOnce();
    expect(screen.getByRole('alert').textContent).not.toMatch(/[\u2014\u2013]/);
  });

  it('keeps the HEMA headline when a refresh fails and retries that read', () => {
    const refetch = vi.fn();
    summaryState.current = liveSummary(false);
    leverageState.current = {
      isLoading: false,
      isError: true,
      data: { items: [hemaFlag()], hemaPharmaCount: 1 },
      refetch,
    };
    renderCard();

    const card = screen.getByTestId('account-agreements-card');
    expect(card.textContent).toContain(HEADLINE);
    expect(card.textContent).toContain('Could not refresh this MSA leverage read.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(screen.getByRole('alert').textContent).not.toMatch(/[\u2014\u2013]/);
  });

  it('keeps a settled empty read from looking confirmed when a refresh fails', () => {
    const refetch = vi.fn();
    summaryState.current = liveSummary(false);
    leverageState.current = {
      isLoading: false,
      isError: true,
      data: { items: [], hemaPharmaCount: 0 },
      refetch,
    };
    renderCard();

    expect(screen.queryByText(HEADLINE)).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Could not refresh this MSA leverage read.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('does not offer Retry when the leverage read settled with no flag', () => {
    summaryState.current = liveSummary(false);
    leverageState.current = {
      isLoading: false,
      isError: false,
      data: { items: [], hemaPharmaCount: 0 },
      refetch: vi.fn(),
    };
    renderCard();

    expect(screen.getByTestId('account-agreements-card').textContent).toContain('HEMA master services agreement');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByText(HEADLINE)).toBeNull();
    expect(screen.queryByText(/Could not/)).toBeNull();
  });

  it('does not offer a leverage Retry on the Sample preview', () => {
    // Sample means the MSA routes are missing. Retry would call a read the
    // preview already refused to start.
    summaryState.current = liveSummary(true);
    leverageState.current = { isLoading: false, isError: true, data: undefined, refetch: vi.fn() };
    renderCard();

    expect(screen.getByText('Sample')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByText(/Could not/)).toBeNull();
    expect(screen.queryByText(/Loading the MSA leverage read/)).toBeNull();
  });

  it('says the leverage read is still loading instead of an agreement with no flag', () => {
    summaryState.current = liveSummary(false);
    leverageState.current = { isLoading: true, isError: false, data: undefined, refetch: vi.fn() };
    renderCard();

    expect(screen.getByText('Loading the MSA leverage read.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByText(HEADLINE)).toBeNull();
  });
});

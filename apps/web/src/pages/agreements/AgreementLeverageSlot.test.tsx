import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MsaLeverageFlag } from '@bidstack/shared';

import { AgreementLeverageSlot, type AgreementLeverageQuery } from './AgreementLeverageSlot';

const THIS_ID = 'a0000000-0000-4000-8000-000000000101';
const OTHER_ID = 'a0000000-0000-4000-8000-000000000102';
const HEADLINE = 'MSA in place via HEMA, no IT business yet: use the existing MSA to enter IT';

function flag(msaId: string): MsaLeverageFlag {
  return {
    companyId: 'c0000000-0000-4000-8000-0000000000aa',
    companyName: 'Northwind Pharma',
    msaId,
    msaTitle: 'HEMA master services agreement',
    signingEntity: {
      id: 'e0000000-0000-4000-8000-000000000001',
      slug: 'hema',
      name: 'HEMA',
      brandFamily: 'amaris',
      businessLines: ['health_economics', 'market_access', 'pharma'],
      verificationStatus: 'verified',
    },
    coveredLines: ['health_economics', 'market_access', 'pharma'],
    missingLines: ['it', 'engineering', 'digital'],
    headline: HEADLINE,
    scopeAllowsOtherServices: false,
    scopeNeedsAmendment: true,
    scopeCitation: { page: 1, clause: 'Clause 3', excerpt: 'does not include information technology' },
  };
}

function query(over: Partial<AgreementLeverageQuery> = {}): AgreementLeverageQuery {
  return {
    isLoading: false,
    isError: false,
    data: { flag: flag(THIS_ID) },
    refetch: vi.fn(),
    ...over,
  };
}

function renderSlot(props: { sample?: boolean; agreementId?: string; query: AgreementLeverageQuery }) {
  return render(
    <MemoryRouter>
      <AgreementLeverageSlot sample={props.sample ?? false} agreementId={props.agreementId ?? THIS_ID} query={props.query} />
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('agreement HEMA leverage slot', () => {
  it('does not pin a sibling HEMA flag on this agreement', () => {
    // WHY: The leverage read is per company. The first flag can belong to
    // another MSA. This page is the document the rep opened.
    renderSlot({ query: query({ data: { flag: flag(OTHER_ID) } }) });
    expect(screen.queryByTestId('msa-leverage-flag')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('says the leverage read failed instead of looking like Northwind has no HEMA MSA', () => {
    const refetch = vi.fn();
    renderSlot({ query: query({ isError: true, data: undefined, refetch }) });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Could not load the MSA leverage read.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toMatch(/[\u2014\u2013]/);
  });

  it('keeps the HEMA flag on this agreement when a refresh fails and retries that read', () => {
    const refetch = vi.fn();
    renderSlot({ query: query({ isError: true, data: { flag: flag(THIS_ID) }, refetch }) });
    expect(screen.getByText(HEADLINE)).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Could not refresh this MSA leverage read.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Could not load the MSA leverage read.')).toBeNull();
  });

  it('does not offer Retry on the Sample preview', () => {
    // WHY: The Sample preview is not the live HEMA agreement. Retry would
    // repeat a leverage read that preview cannot answer.
    renderSlot({
      sample: true,
      query: query({ isError: true, data: { flag: flag(THIS_ID) }, refetch: vi.fn() }),
    });
    expect(screen.queryByTestId('msa-leverage-flag')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the HEMA flag for this agreement and no Retry after a successful read', () => {
    renderSlot({ query: query() });
    expect(screen.getByText(HEADLINE)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('does not call a settled empty read a failure', () => {
    renderSlot({ query: query({ data: { flag: null } }) });
    expect(screen.queryByTestId('msa-leverage-flag')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});

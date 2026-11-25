import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AccountPositioning, MsaLeverageFlag } from '@bidstack/shared';

// WHY: Demo Northwind Pharma exists so the account brief can say the HEMA MSA
// is in place and IT is not. The brief and the leverage read are separate.
// A failed leverage read, or a brief that is still loading, must not look like
// that MSA is absent. Retry has to repeat the leverage read.

const HEADLINE =
  'MSA in place via HEMA, no IT business yet: use the existing MSA to enter IT';

const positioning: AccountPositioning = {
  companyId: 'northwind',
  sample: false,
  computedAt: '2026-11-01T00:00:00.000Z',
  brief: {
    name: 'Northwind Pharma',
    tierLabel: 'Strategic',
    industry: 'Healthcare',
    country: 'FR',
    employees: { value: 1200, source: 'Account record' },
    momentum: null,
    financials: null,
    pipeline: { openCount: 0, openMicros: '0', won24m: 0, lost24m: 0 },
    people: { known: 1, senior: 1, metLast12m: 0, lastMeeting: null },
    topSignal: null,
  },
  plays: [],
  gaps: [],
};

const flag: MsaLeverageFlag = {
  companyId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  companyName: 'Northwind Pharma',
  msaId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  msaTitle: 'HEMA master services agreement',
  signingEntity: {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    slug: 'hema',
    name: 'HEMA',
    brandFamily: 'amaris',
    businessLines: ['pharma'],
    verificationStatus: 'verified',
  },
  coveredLines: ['pharma'],
  missingLines: ['it', 'engineering', 'digital'],
  headline: HEADLINE,
  scopeAllowsOtherServices: false,
  scopeNeedsAmendment: true,
  scopeCitation: { page: 1, clause: 'Clause 3', excerpt: 'does not include information technology' },
};

const briefState: { current: { isLoading: boolean; isError: boolean; data?: AccountPositioning; refetch: () => void } } = {
  current: { isLoading: false, isError: false, data: positioning, refetch: vi.fn() },
};
const leverageState: {
  current: {
    isLoading: boolean;
    isError: boolean;
    data?: { items: MsaLeverageFlag[] };
    refetch: () => void;
  };
} = {
  current: { isLoading: false, isError: false, data: { items: [] }, refetch: vi.fn() },
};

vi.mock('@/hooks/useAccountPositioning', () => ({
  useAccountPositioning: () => briefState.current,
}));
vi.mock('@/hooks/useMsaLeverage', () => ({
  useMsaLeverage: () => leverageState.current,
}));

import { WhatToPosition } from './WhatToPosition';

afterEach(() => {
  cleanup();
  briefState.current = { isLoading: false, isError: false, data: positioning, refetch: vi.fn() };
  leverageState.current = { isLoading: false, isError: false, data: { items: [] }, refetch: vi.fn() };
});

function renderBrief() {
  return render(
    <MemoryRouter>
      <WhatToPosition companyId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" />
    </MemoryRouter>,
  );
}

function retryIn(alert: HTMLElement) {
  return within(alert).getByRole('button', { name: 'Retry' });
}

describe('What to position keeps the HEMA leverage read honest', () => {
  it('says the leverage read failed instead of an empty HEMA opportunity', () => {
    const refetch = vi.fn();
    leverageState.current = { isLoading: false, isError: true, data: undefined, refetch };
    renderBrief();

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Could not load the MSA leverage read.');
    fireEvent.click(retryIn(alert));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toMatch(/[\u2014\u2013]/);
  });

  it('keeps the HEMA headline when a refresh fails and retries that read', () => {
    const refetch = vi.fn();
    leverageState.current = {
      isLoading: false,
      isError: true,
      data: { items: [flag] },
      refetch,
    };
    renderBrief();

    expect(screen.getByText(HEADLINE)).toBeTruthy();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Could not refresh this MSA leverage read.');
    fireEvent.click(retryIn(alert));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Could not load the MSA leverage read.')).toBeNull();
  });

  it('keeps a loaded HEMA flag on screen when the brief itself fails', () => {
    const refetchBrief = vi.fn();
    briefState.current = { isLoading: false, isError: true, data: undefined, refetch: refetchBrief };
    leverageState.current = { isLoading: false, isError: false, data: { items: [flag] }, refetch: vi.fn() };
    renderBrief();

    expect(screen.getByText(HEADLINE)).toBeTruthy();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain("Couldn't load what to position");
    fireEvent.click(retryIn(alert));
    expect(refetchBrief).toHaveBeenCalledTimes(1);
  });

  it('shows a loaded HEMA flag while the brief is still loading', () => {
    briefState.current = { isLoading: true, isError: false, data: undefined, refetch: vi.fn() };
    leverageState.current = { isLoading: false, isError: false, data: { items: [flag] }, refetch: vi.fn() };
    renderBrief();

    expect(screen.getByText(HEADLINE)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('does not offer a leverage Retry when the read settled with no flag', () => {
    renderBrief();

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.getByText('No play to recommend yet')).toBeTruthy();
  });
});

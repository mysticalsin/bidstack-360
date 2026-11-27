import { cleanup, render, screen } from '@testing-library/react';
import type { ComponentProps, ElementType, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ContractAgreementsCard } from './ContractAgreementsCard';
import type { ContractAgreement, ContractFieldProvenance } from '@bidstack/shared';

const hookMocks = vi.hoisted(() => ({
  agreements: [] as ContractAgreement[] | undefined,
  isLoading: false,
  isError: false,
  error: null as Error | null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values[key] ?? ''));
    },
  }),
}));

vi.mock('framer-motion', async () => {
  const React = await import('react');
  const motionComponent = (tag: ElementType) => {
    const Component = React.forwardRef<HTMLElement, ComponentProps<'div'> & { children?: ReactNode }>(
      ({ children, ...props }, ref) => {
        const { animate, initial, transition, whileHover, whileTap, ...domProps } =
          props as Record<string, unknown>;
        void animate;
        void initial;
        void transition;
        void whileHover;
        void whileTap;
        return React.createElement(tag, { ...domProps, ref }, children);
      },
    );
    Component.displayName = `Motion${String(tag)}`;
    return Component;
  };

  return {
    motion: new Proxy(
      {},
      {
        get: (_target, tag: string) => motionComponent(tag),
      },
    ),
    useReducedMotion: () => true,
  };
});

vi.mock('@/lib/auth', () => ({
  useIsAdmin: () => false,
}));

vi.mock('@/hooks/useContractAgreements', () => ({
  useContractAgreements: () => ({
    data: hookMocks.agreements,
    isLoading: hookMocks.isLoading,
    isError: hookMocks.isError,
    error: hookMocks.error,
  }),
  useCreateContractAgreement: () => ({ mutate: vi.fn(), isPending: false }),
  useApproveContractExtraction: () => ({ mutate: vi.fn(), isPending: false }),
  useExtractContract: () => ({ mutate: vi.fn(), isPending: false }),
  useContractExtraction: () => ({ data: null }),
}));

vi.mock('@/hooks/useFiles', () => ({
  useUploadFile: () => ({ mutate: vi.fn(), isPending: false }),
  downloadFileUrl: (id: string) => `/api/files/${id}/download`,
}));

vi.mock('@/components/ui/Toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/hooks/useUiSound', () => ({
  useUiSound: () => vi.fn(),
}));

const aiSource: ContractFieldProvenance = {
  source: 'derived:llm',
  label: 'AI reviewed',
  hint: 'Human-reviewed AI extraction from MSA-review.pdf. Saved 2026-06-16.',
  confidence: 0.85,
  sourceFileId: '11111111-1111-4111-8111-111111111111',
  sourceFileName: 'MSA-review.pdf',
  sourceExtractionId: '22222222-2222-4222-8222-222222222222',
  updatedAt: '2026-06-16T12:00:00.000Z',
};

function agreement(): ContractAgreement {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    accountKey: 'acme',
    kind: 'msa',
    reference: 'MSA-REVIEWED-001',
    countries: ['FR', 'DE'],
    globalRebateBps: 750,
    currency: 'EUR',
    rateCard: [{ role: 'Architect', rateMicros: 1_100_000_000, unit: 'day' }],
    effectiveDate: null,
    expiryDate: '2028-12-31T00:00:00.000Z',
    rateReviewSchedule: 'annual',
    nextRateReviewAt: '2027-01-15T00:00:00.000Z',
    status: 'active',
    notes: null,
    sourceFileId: '11111111-1111-4111-8111-111111111111',
    sourceFileName: 'MSA-review.pdf',
    sourceExtractionId: '22222222-2222-4222-8222-222222222222',
    fieldSources: {
      reference: aiSource,
      countries: aiSource,
      globalRebateBps: aiSource,
      rateReviewSchedule: aiSource,
      nextRateReviewAt: aiSource,
      expiryDate: aiSource,
      rateCard: aiSource,
    },
    createdAt: '2026-06-16T12:00:00.000Z',
    updatedAt: '2026-06-16T12:00:00.000Z',
  };
}

describe('ContractAgreementsCard provenance', () => {
  beforeEach(() => {
    hookMocks.agreements = [];
    hookMocks.isLoading = false;
    hookMocks.isError = false;
    hookMocks.error = null;
  });

  afterEach(() => {
    cleanup();
  });

  it('shows compact source badges on decision-critical contract fields', () => {
    hookMocks.agreements = [agreement()];

    render(<ContractAgreementsCard accountKey="acme" />);

    expect(screen.getByText('MSA-REVIEWED-001')).toBeTruthy();
    expect(screen.getByTestId('contract-summary-source-active').textContent).toBe(
      'Reviewed extraction',
    );
    expect(screen.getByTestId('contract-summary-source-coverage').textContent).toBe(
      'Reviewed extraction',
    );
    expect(screen.getByTestId('contract-summary-source-next').getAttribute('aria-label')).toContain(
      'Next legal review date is derived from 1 agreement record(s)',
    );
    expect(
      screen.getByTestId('contract-source-33333333-3333-4333-8333-333333333333-reference')
        .textContent,
    ).toBe('AI reviewed');
    expect(
      screen
        .getByTestId('contract-source-33333333-3333-4333-8333-333333333333-countries')
        .getAttribute('aria-label'),
    ).toBe(aiSource.hint);
    expect(
      screen.getByTestId('contract-source-33333333-3333-4333-8333-333333333333-rebate')
        .textContent,
    ).toBe('AI reviewed');
    expect(
      screen.getByTestId('contract-source-33333333-3333-4333-8333-333333333333-rate-review')
        .textContent,
    ).toBe('AI reviewed');
    expect(
      screen.getByTestId('contract-source-33333333-3333-4333-8333-333333333333-rate-card')
        .textContent,
    ).toBe('AI reviewed');
  });

  it('does not call an unread agreement list an empty book', () => {
    // WHY: a pending or paused read reports isLoading false and no payload.
    // "No MSAs..." is only true after a settled list with zero agreements.
    // Sellers must not treat a contract book that has not arrived as none.
    hookMocks.agreements = undefined;
    hookMocks.isLoading = false;
    hookMocks.isError = false;
    hookMocks.error = null;

    render(<ContractAgreementsCard accountKey="acme" />);

    expect(screen.queryByText(/No MSAs or framework agreements/)).toBeNull();
    expect(screen.queryByText('None')).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it('does not call a failed agreement read an empty book', () => {
    // WHY: a failed read is unknown, not a book of zero. Pricing a deal
    // against "no MSA on file" when the load failed would skip a real contract.
    hookMocks.agreements = undefined;
    hookMocks.isLoading = false;
    hookMocks.isError = true;
    hookMocks.error = new Error('agreements down');

    render(<ContractAgreementsCard accountKey="acme" />);

    expect(screen.queryByText(/No MSAs or framework agreements/)).toBeNull();
    expect(screen.getByText('Could not load contractual agreements')).toBeTruthy();
  });

  it('still says there are no agreements after a settled empty list', () => {
    // WHY: an arrived payload of zero agreements is a real empty book.
    hookMocks.agreements = [];
    hookMocks.isLoading = false;
    hookMocks.isError = false;
    hookMocks.error = null;

    render(<ContractAgreementsCard accountKey="acme" />);

    expect(
      screen.getByText('No MSAs or framework agreements recorded for this account yet.'),
    ).toBeTruthy();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });
});

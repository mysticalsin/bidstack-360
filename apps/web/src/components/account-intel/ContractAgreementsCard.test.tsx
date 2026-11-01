import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps, ElementType, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ContractAgreementCreate } from '@bidstack/shared';
import {
  ContractAgreementsCard,
  agreementRateMicros,
  contractCurrencyCode,
} from './ContractAgreementsCard';
import type { ContractAgreement, ContractFieldProvenance } from '@bidstack/shared';

const hookMocks = vi.hoisted(() => ({
  agreements: [] as ContractAgreement[],
  isAdmin: false,
  create: vi.fn(),
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
    const Component = React.forwardRef<
      HTMLElement,
      ComponentProps<'div'> & { children?: ReactNode }
    >(({ children, ...props }, ref) => {
      const { animate, initial, transition, whileHover, whileTap, ...domProps } = props as Record<
        string,
        unknown
      >;
      void animate;
      void initial;
      void transition;
      void whileHover;
      void whileTap;
      return React.createElement(tag, { ...domProps, ref }, children);
    });
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
  useIsAdmin: () => hookMocks.isAdmin,
}));

vi.mock('@/hooks/useContractAgreements', () => ({
  useContractAgreements: () => ({
    data: hookMocks.agreements,
    isLoading: false,
    isError: false,
    error: null,
  }),
  useCreateContractAgreement: () => ({ mutate: hookMocks.create, isPending: false }),
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

afterEach(() => {
  cleanup();
  hookMocks.create.mockReset();
});

describe('contract currency', () => {
  it('does not turn a blank currency into euros', () => {
    // Why: the add-agreement form used to submit EUR whenever the field was empty.
    expect(contractCurrencyCode('')).toBeNull();
    expect(contractCurrencyCode('  ')).toBeNull();
    expect(contractCurrencyCode('EU')).toBeNull();
    expect(contractCurrencyCode('nok')).toBe('NOK');
  });

  it('rejects a create body that omits currency instead of defaulting to EUR', () => {
    const parsed = ContractAgreementCreate.safeParse({
      accountKey: 'acme',
      reference: 'MSA-1',
    });
    expect(parsed.success).toBe(false);
  });

  it('stores a fractional day rate as integer micros', () => {
    // WHY: Math.round(rate * 1e6) cannot keep 850.50 as 850_500_000.
    expect(agreementRateMicros('850.50')).toBe(850_500_000);
    expect(agreementRateMicros('nope')).toBeNull();
    expect(agreementRateMicros('1.2345678')).toBeNull();
  });

  it('saves a typed rate as integer micros and refuses a bad line', () => {
    hookMocks.agreements = [];
    hookMocks.isAdmin = true;
    render(<ContractAgreementsCard accountKey="acme" />);
    fireEvent.click(screen.getByRole('button', { name: 'Add agreement' }));
    fireEvent.change(screen.getByLabelText('Contract reference'), {
      target: { value: 'MSA-1' },
    });
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'USD' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add rate line' }));
    fireEvent.change(screen.getByLabelText('Rate line 1 role'), {
      target: { value: 'Architect' },
    });
    fireEvent.change(screen.getByLabelText('Rate line 1 rate'), { target: { value: '850.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(hookMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        currency: 'USD',
        reference: 'MSA-1',
        rateCard: [{ role: 'Architect', rateMicros: 850_500_000, unit: 'day' }],
      }),
      expect.anything(),
    );

    hookMocks.create.mockClear();
    fireEvent.change(screen.getByLabelText('Rate line 1 rate'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(hookMocks.create).not.toHaveBeenCalled();
  });

  it('opens the add-agreement form with an empty currency field', () => {
    hookMocks.agreements = [];
    hookMocks.isAdmin = true;
    render(<ContractAgreementsCard accountKey="acme" />);
    fireEvent.click(screen.getByRole('button', { name: 'Add agreement' }));
    expect((screen.getByLabelText('Currency') as HTMLInputElement).value).toBe('');
  });
});

describe('ContractAgreementsCard provenance', () => {
  it('shows compact source badges on decision-critical contract fields', () => {
    hookMocks.isAdmin = false;
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
      screen.getByTestId('contract-source-33333333-3333-4333-8333-333333333333-rebate').textContent,
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
});

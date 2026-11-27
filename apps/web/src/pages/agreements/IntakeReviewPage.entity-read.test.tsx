// A paused or in-flight signing-entity read has no catalog yet. The review
// select said Not confirmed. That read has not arrived, so confirm must not
// save a missing entity as a choice.
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { extractMsaFields, SYNTHETIC_NORTHWIND_MSA_TEXT } from '@bidstack/shared';

const hookMocks = vi.hoisted(() => ({
  useSigningEntities: vi.fn(),
  useMsaIntakeDraft: vi.fn(),
  useConfirmMsaIntake: vi.fn(),
}));

vi.mock('@/hooks/useMsaIntake', () => ({
  useMsaIntakeDraft: hookMocks.useMsaIntakeDraft,
  useConfirmMsaIntake: hookMocks.useConfirmMsaIntake,
}));
vi.mock('@/hooks/useCompanies', () => ({
  useCompanies: () => ({
    data: { items: [{ id: 'c0000000-0000-4000-8000-0000000000aa', name: 'Northwind Pharma' }] },
    isError: false,
    status: 'success',
  }),
}));
vi.mock('@/hooks/useSigningEntities', () => ({
  useSigningEntities: hookMocks.useSigningEntities,
}));

import IntakeReviewPage from './IntakeReviewPage';

const CHECKING = 'Checking signing entities. The list has not arrived.';
const FAILED = 'Could not load signing entities.';
const NONE = 'Not confirmed';
const ENTITY_ID = 'e0000000-0000-4000-8000-0000000000bb';

function entity(status: 'verified' | 'unverified') {
  return {
    id: ENTITY_ID,
    slug: 'northwind',
    name: 'Northwind Advisory',
    legalName: 'Northwind Advisory LLC',
    brandFamily: 'other' as const,
    aliases: [] as string[],
    businessLines: [] as string[],
    sourceUrl: 'https://example.test/northwind',
    verificationStatus: status,
  };
}

function renderReview(query: {
  data?: { items: ReturnType<typeof entity>[] } | null;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  status?: string;
}) {
  hookMocks.useSigningEntities.mockReturnValue(query);
  hookMocks.useConfirmMsaIntake.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  hookMocks.useMsaIntakeDraft.mockReturnValue({
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
      signingEntityMatches: [],
      warnings: [],
      confirmedContractId: null,
      createdAt: '2026-11-01T00:00:00.000Z',
    },
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/agreements/intake/d0000000-0000-4000-8000-0000000000aa']}>
        <Routes>
          <Route path="/agreements/intake/:id" element={<IntakeReviewPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function confirmButton() {
  return screen.getByTestId('msa-review-confirm') as HTMLButtonElement;
}

describe('Intake review signing entity read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused signing-entity read as Not confirmed', () => {
    // WHY: a paused first read has isLoading false and no catalog. Not
    // confirmed says the reader chose none. This catalog has not arrived.
    renderReview({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'pending',
    });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByRole('option', { name: NONE })).toBeNull();
    expect(screen.queryByTestId('msa-review-entity')).toBeNull();
    expect(confirmButton().disabled).toBe(true);
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText('Northwind Advisory')).toBeNull();
  });

  it('does not treat an in-flight signing-entity read as Not confirmed', () => {
    // WHY: a slow read also has no catalog, and isLoading can stay false.
    // Not confirmed must not stand in for a read that is still running.
    renderReview({
      data: undefined,
      isLoading: false,
      isFetching: true,
      isError: false,
      status: 'pending',
    });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByRole('option', { name: NONE })).toBeNull();
    expect(screen.queryByTestId('msa-review-entity')).toBeNull();
    expect(confirmButton().disabled).toBe(true);
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('keeps a failed signing-entity read on the error', () => {
    // WHY: a failed catalog is not a choice of none. Confirm must not save
    // that miss, and Not confirmed must not stand in for the error.
    renderReview({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      status: 'error',
    });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('option', { name: NONE })).toBeNull();
    expect(screen.queryByTestId('msa-review-entity')).toBeNull();
    expect(confirmButton().disabled).toBe(true);
  });

  it('lets a failed status win when isError is still false', () => {
    // WHY: error wins even when the flag has not flipped. A status of error
    // must not keep Northwind Advisory, and it must not look like none.
    renderReview({
      data: { items: [entity('verified')] },
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'error',
    });

    expect(screen.queryByRole('option', { name: 'Northwind Advisory' })).toBeNull();
    expect(screen.queryByRole('option', { name: NONE })).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(confirmButton().disabled).toBe(true);
  });

  it('stays on Not confirmed when a settled payload is null', () => {
    // WHY: null has arrived. Undefined data is unread. A null catalog is not
    // a failed load, and it is not still checking.
    renderReview({
      data: null,
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
    });

    expect(screen.getByRole('option', { name: NONE })).toBeTruthy();
    expect(screen.getByTestId('msa-review-entity')).toBeTruthy();
    expect(confirmButton().disabled).toBe(false);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('option', { name: 'Northwind Advisory' })).toBeNull();
  });

  it('stays on Not confirmed when a settled list has no entities', () => {
    // WHY: an empty catalog has arrived. Unread must not replace that settled
    // miss, and the miss must not say the load failed.
    renderReview({
      data: { items: [] },
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
    });

    expect(screen.getByRole('option', { name: NONE })).toBeTruthy();
    expect(confirmButton().disabled).toBe(false);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('option', { name: 'Northwind Advisory' })).toBeNull();
  });

  it('still offers a loaded signing entity', () => {
    // WHY: a loaded catalog stays. The unread line must not replace an entity
    // the read already returned, and Not confirmed stays a real choice.
    renderReview({
      data: { items: [entity('verified')] },
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
    });

    expect(screen.getByRole('option', { name: 'Northwind Advisory' })).toBeTruthy();
    expect(screen.getByRole('option', { name: NONE })).toBeTruthy();
    expect(confirmButton().disabled).toBe(false);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('still marks a loaded unverified signing entity', () => {
    // WHY: unverified is loaded data. Unread must not drop the entity, and
    // the option must not invent a verified status.
    renderReview({
      data: { items: [entity('unverified')] },
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
    });

    expect(screen.getByRole('option', { name: 'Northwind Advisory (unverified)' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Northwind Advisory' })).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(confirmButton().disabled).toBe(false);
  });
});

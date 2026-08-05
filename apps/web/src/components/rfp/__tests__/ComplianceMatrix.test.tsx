/**
 * Tests for ComplianceMatrix after the Round-2 density retarget.
 *
 * What changed from the previous version of this file: the matrix is now a real
 * <table> (it was a div list), so the old `role="list"` / `role="region"`
 * assertions are gone and replaced with table roles. The row is no longer
 * mocked — the whole point of the retarget is what a row renders (the three
 * slots: value | provenance | suggestion), so stubbing it out would test
 * nothing that matters.
 *
 * Mock strategy: the two data hooks (compliance + bid facts) and the pipeline
 * store are mocked so the component under test is the only real thing.
 * react-i18next returns the key as-is, so assertions match on keys.
 */
import type { ReactNode } from 'react';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v6';
import { BrowserRouter } from 'react-router-dom';

import { ComplianceMatrix } from '../compliance/ComplianceMatrix';
import type * as BidFactsModule from '@/hooks/agent/useBidFacts';
import type { BidFact } from '@/hooks/agent/useBidFacts';
import type { ComplianceRow as ComplianceRowData } from '@/hooks/rfp/useRfpCompliance';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

vi.mock('@/stores/rfpPipeline', () => ({
  useRfpPipelineStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ bidWorkspaceId: 'ws-001' }),
  ),
}));

vi.mock('@/hooks/rfp/useRfpCompliance', () => ({
  useRfpCompliance: vi.fn(),
  useSaveComplianceRow: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

vi.mock('@/hooks/agent/useBidFacts', async () => {
  const actual = await vi.importActual<typeof BidFactsModule>('@/hooks/agent/useBidFacts');
  return { ...actual, useSubjectBidFacts: vi.fn(), useDecideBidFact: vi.fn() };
});

vi.mock('@/components/ui/Card', () => ({
  Card: ({ children }: { children: ReactNode }) => <div data-testid="card">{children}</div>,
}));

vi.mock('@/components/ui/StateMessages', () => ({
  LoadingSkeleton: () => <div data-testid="loading-skeleton" />,
  EmptyState: ({ title, message }: { title: string; message?: string }) => (
    <div data-testid="empty-state">
      <span>{title}</span>
      {message ? <span>{message}</span> : null}
    </div>
  ),
}));

import { useRfpCompliance } from '@/hooks/rfp/useRfpCompliance';
import { useDecideBidFact, useSubjectBidFacts } from '@/hooks/agent/useBidFacts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ComplianceResult = {
  items: ComplianceRowData[];
  total: number;
  compliantCount: number;
  pendingCount: number;
};

function mockCompliance(value: {
  data?: ComplianceResult;
  isLoading?: boolean;
  isError?: boolean;
  error?: Error | null;
}) {
  vi.mocked(useRfpCompliance).mockReturnValue({
    data: value.data,
    isLoading: value.isLoading ?? false,
    isError: value.isError ?? false,
    error: value.error ?? null,
    isPending: value.isLoading ?? false,
    isSuccess: !!value.data,
    status: value.isLoading ? 'pending' : value.isError ? 'error' : 'success',
  } as ReturnType<typeof useRfpCompliance>);
}

const decideMutate = vi.fn();

function mockFacts(bySubject: Record<string, { proposed?: BidFact[]; applied?: BidFact[] }> = {}) {
  const map = new Map(
    Object.entries(bySubject).map(([subjectId, buckets]) => [
      subjectId,
      { proposed: buckets.proposed ?? [], applied: buckets.applied ?? [] },
    ]),
  );
  vi.mocked(useSubjectBidFacts).mockReturnValue({
    bySubject: map,
    all: [...map.values()].flatMap((entry) => [...entry.proposed, ...entry.applied]),
    isFetching: false,
  });
  vi.mocked(useDecideBidFact).mockReturnValue({
    mutate: decideMutate,
    isPending: false,
    isError: false,
    error: null,
    variables: undefined,
  } as unknown as ReturnType<typeof useDecideBidFact>);
}

function makeRow(overrides: Partial<ComplianceRowData> = {}): ComplianceRowData {
  return {
    id: 'row-1',
    requirement: 'Must provide SOC 2 Type II evidence',
    response: null,
    status: 'pending',
    autoFilled: false,
    aiConfidenceBps: null,
    assessmentStatus: 'PENDING',
    section: null,
    mandatory: false,
    ...overrides,
  };
}

function makeFact(overrides: Partial<BidFact> = {}): BidFact {
  return {
    id: 'fact-1',
    opportunityId: 'ws-001',
    subjectType: 'matrix_row',
    subjectId: 'row-1',
    claim: 'YES — hosting is delivered from EU datacentres',
    verdict: 'YES',
    confidenceBps: 9100,
    band: 'VERIFIED',
    assessmentStatus: 'ASSESSED',
    rationale: 'The bid library states this directly',
    status: 'PROPOSED',
    producedByAgentKey: 'compliance-fill',
    decidedByUserId: null,
    decidedAt: null,
    createdAt: '2026-08-01T09:00:00.000Z',
    citations: [],
    ...overrides,
  };
}

function renderMatrix(url = '/rfp/ws-001/pipeline') {
  window.history.replaceState(null, '', url);
  return render(<ComplianceMatrix />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <NuqsAdapter>{children}</NuqsAdapter>
      </BrowserRouter>
    ),
  });
}

function result(items: ComplianceRowData[]): ComplianceResult {
  return {
    items,
    total: items.length,
    compliantCount: items.filter((item) => item.status === 'compliant').length,
    pendingCount: items.filter((item) => item.status === 'pending').length,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFacts();
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

// ---------------------------------------------------------------------------

describe('ComplianceMatrix — fetch states', () => {
  it('shows a loading skeleton and no rows while fetching', () => {
    mockCompliance({ isLoading: true });
    renderMatrix();
    expect(screen.getByTestId('loading-skeleton')).toBeDefined();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows an error alert when the query errors', () => {
    mockCompliance({ isError: true, error: new Error('Network failure') });
    renderMatrix();
    expect(screen.getByRole('alert')).toBeDefined();
  });

  it('shows the empty state for an empty matrix and for no data at all', () => {
    mockCompliance({ data: result([]) });
    renderMatrix();
    expect(screen.getByTestId('empty-state')).toBeDefined();
    cleanup();

    mockCompliance({ data: undefined });
    renderMatrix();
    expect(screen.getByTestId('empty-state')).toBeDefined();
  });
});

describe('ComplianceMatrix — density', () => {
  it('renders one table row per requirement plus the header row', () => {
    mockCompliance({
      data: result([
        makeRow({ id: 'r1', requirement: 'ISO 27001 certificate' }),
        makeRow({ id: 'r2', requirement: 'GDPR DPA signed' }),
      ]),
    });
    renderMatrix();
    expect(screen.getByRole('table')).toBeDefined();
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getByText('ISO 27001 certificate')).toBeDefined();
    expect(screen.getByText('GDPR DPA signed')).toBeDefined();
  });

  it('renders an em-dash for a missing answer and for a null confidence', () => {
    mockCompliance({ data: result([makeRow({ response: null, aiConfidenceBps: null })]) });
    renderMatrix();
    // One in the answer cell, one in the confidence cell — never a 0%.
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.queryByText('0%')).toBeNull();
  });

  it('renders an unassessed row NEUTRALLY — pending status, no red verdict', () => {
    mockCompliance({
      data: result([makeRow({ status: 'pending', assessmentStatus: 'UNAVAILABLE' })]),
    });
    renderMatrix();
    expect(screen.getByText('compliance.status.pending')).toBeDefined();
    expect(screen.getByText('compliance.notAssessed')).toBeDefined();
    expect(screen.queryByText('compliance.status.non_compliant')).toBeNull();
    // The status dot carries its tone as data — neutral, not error.
    const dot = document.querySelector('[data-slot="indicator-dot"]');
    expect(dot?.getAttribute('data-tone')).toBe('neutral');
  });

  it('paginates at 25 rows and reproduces page 2 from the URL', () => {
    const rows = Array.from({ length: 26 }, (_, index) =>
      makeRow({ id: `r${index}`, requirement: `Requirement ${index}` }),
    );
    mockCompliance({ data: result(rows) });
    renderMatrix();
    expect(screen.getAllByRole('row')).toHaveLength(26); // 25 rows + header
    cleanup();

    mockCompliance({ data: result(rows) });
    renderMatrix('/rfp/ws-001/pipeline?page=2');
    expect(screen.getAllByRole('row')).toHaveLength(2); // 1 row + header
    expect(screen.getByText('Requirement 25')).toBeDefined();
  });

  it('applies the ?status= facet from the URL', () => {
    mockCompliance({
      data: result([
        makeRow({ id: 'r1', requirement: 'Compliant one', status: 'compliant' }),
        makeRow({ id: 'r2', requirement: 'Pending one', status: 'pending' }),
      ]),
    });
    renderMatrix('/rfp/ws-001/pipeline?status=compliant');
    expect(screen.getByText('Compliant one')).toBeDefined();
    expect(screen.queryByText('Pending one')).toBeNull();
  });
});

describe('ComplianceMatrix — the strip', () => {
  it('renders a proposed fact as an accept/dismiss strip under its row', () => {
    mockCompliance({ data: result([makeRow({ id: 'row-1' })]) });
    mockFacts({ 'row-1': { proposed: [makeFact()] } });
    renderMatrix();

    const strip = document.querySelector('[data-slot="agent-suggestion"]');
    expect(strip).not.toBeNull();
    expect(within(strip as HTMLElement).getByText(/EU datacentres/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'agent.acceptAria' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'agent.dismissAria' })).toBeDefined();
  });

  it('accepts and dismisses through the decide mutation, carrying the subject id', () => {
    mockCompliance({ data: result([makeRow({ id: 'row-1' })]) });
    mockFacts({ 'row-1': { proposed: [makeFact({ id: 'fact-9' })] } });
    renderMatrix();

    fireEvent.click(screen.getByRole('button', { name: 'agent.acceptAria' }));
    expect(decideMutate).toHaveBeenCalledWith({
      factId: 'fact-9',
      decision: 'accept',
      subjectId: 'row-1',
    });

    fireEvent.click(screen.getByRole('button', { name: 'agent.dismissAria' }));
    expect(decideMutate).toHaveBeenLastCalledWith({
      factId: 'fact-9',
      decision: 'dismiss',
      subjectId: 'row-1',
    });
  });

  it('marks a held fact amber and never as an error', () => {
    mockCompliance({ data: result([makeRow({ id: 'row-1' })]) });
    mockFacts({
      'row-1': {
        proposed: [
          makeFact({
            rationale: 'Held: amendment 2 contradicts the base document on SLA.',
            confidenceBps: 4500,
            band: 'POSSIBLE',
          }),
        ],
      },
    });
    renderMatrix();

    const strip = document.querySelector('[data-slot="agent-suggestion"]');
    expect(strip?.getAttribute('data-held')).toBe('true');
    expect(strip?.className).toContain('warning');
    expect(strip?.className).not.toContain('danger');
  });

  it('gives an applied answer the sourced-value underline; a bare answer keeps none', () => {
    mockCompliance({
      data: result([
        makeRow({ id: 'row-1', response: 'Yes, EU only', autoFilled: true }),
        makeRow({ id: 'row-2', response: 'Typed by a person' }),
      ]),
    });
    mockFacts({ 'row-1': { applied: [makeFact({ status: 'APPLIED' })] } });
    renderMatrix();

    const applied = screen.getByText('Yes, EU only');
    const typed = screen.getByText('Typed by a person');
    expect(applied.className).toContain('decoration-dotted');
    expect(typed.className).not.toContain('decoration-dotted');
  });
});

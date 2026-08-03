/**
 * Tests for ComplianceMatrix.
 *
 * Implementation notes (spec vs reality):
 * - The spec describes an "Autofill button per row" — the real ComplianceRow
 *   has an Edit/Done toggle button, not Autofill. Tests reflect the real
 *   component structure.
 * - The spec says "AI badge on rows where answerDraft is present" — the real
 *   component shows AI confidence % on rows where `autoFilled=true`. Tests
 *   use `autoFilled` as the discriminator.
 * - ComplianceRow is mocked here to keep the matrix tests focused on
 *   data-loading, list rendering, and state display rather than row internals
 *   (ComplianceRow has its own test surface).
 *
 * Mock strategy: vi.mock the useRfpCompliance hook and useRfpPipelineStore
 * to inject controlled data. react-i18next returns key as-is.
 * framer-motion is mocked to prevent animation timer issues.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { ComplianceMatrix } from '../compliance/ComplianceMatrix';
import type { ComplianceRow as ComplianceRowData } from '@/hooks/rfp/useRfpCompliance';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/stores/rfpPipeline', () => ({
  useRfpPipelineStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ bidWorkspaceId: 'ws-001' }),
  ),
}));

vi.mock('@/hooks/rfp/useRfpCompliance', () => ({
  useRfpCompliance: vi.fn(),
  // useSaveComplianceRow must be mocked here because ComplianceMatrix now calls
  // it at render time; without the mock it would throw "not a function".
  useSaveComplianceRow: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
}));

// Stub Card to avoid framer-motion / CSS-var complexity
vi.mock('@/components/ui/Card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div data-testid="card">{children}</div>,
}));

// Stub StateMessages to isolate matrix from animation library
vi.mock('@/components/ui/StateMessages', () => ({
  LoadingSkeleton: () => <div data-testid="loading-skeleton" />,
  EmptyState: ({ title, message }: { title: string; message?: string }) => (
    <div data-testid="empty-state">
      <span>{title}</span>
      {message ? <span>{message}</span> : null}
    </div>
  ),
}));

// Stub ComplianceRow — renders the row id and requirement so matrix tests can
// count rows without depending on ComplianceRow's internal DOM structure.
vi.mock('../compliance/ComplianceRow', () => ({
  ComplianceRow: ({ row }: { row: ComplianceRowData }) => (
    <div data-testid="compliance-row" data-row-id={row.id}>
      <span>{row.requirement}</span>
      {row.autoFilled && <span data-testid="ai-filled-indicator">AI filled</span>}
    </div>
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { useRfpCompliance } from '@/hooks/rfp/useRfpCompliance';

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
    // Satisfy the full UseQueryResult shape with no-ops for unused fields
    isPending: value.isLoading ?? false,
    isSuccess: !!value.data,
    status: value.isLoading ? 'pending' : value.isError ? 'error' : 'success',
  } as ReturnType<typeof useRfpCompliance>);
}

function makeRow(overrides: Partial<ComplianceRowData> = {}): ComplianceRowData {
  return {
    id: overrides.id ?? 'row-1',
    requirement: overrides.requirement ?? 'Must provide SOC 2 Type II evidence',
    response: overrides.response ?? null,
    status: overrides.status ?? 'pending',
    autoFilled: overrides.autoFilled ?? false,
    // Null is the honest default: a fresh row has no assessment confidence.
    aiConfidenceBps: overrides.aiConfidenceBps ?? null,
    assessmentStatus: overrides.assessmentStatus ?? 'PENDING',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Before/after
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Loading state
// ---------------------------------------------------------------------------

describe('ComplianceMatrix — loading state', () => {
  it('shows a loading skeleton while data is fetching', () => {
    mockCompliance({ isLoading: true });
    render(<ComplianceMatrix />);
    expect(screen.getByTestId('loading-skeleton')).toBeDefined();
  });

  it('does NOT render rows while loading', () => {
    mockCompliance({ isLoading: true });
    render(<ComplianceMatrix />);
    expect(screen.queryByTestId('compliance-row')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

describe('ComplianceMatrix — error state', () => {
  it('shows an error alert when the query errors', () => {
    mockCompliance({ isError: true, error: new Error('Network failure') });
    render(<ComplianceMatrix />);
    expect(screen.getByRole('alert')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe('ComplianceMatrix — empty state', () => {
  it('shows the empty state when the items array is empty', () => {
    mockCompliance({
      data: { items: [], total: 0, compliantCount: 0, pendingCount: 0 },
    });
    render(<ComplianceMatrix />);
    expect(screen.getByTestId('empty-state')).toBeDefined();
  });

  it('shows the empty state when data is null', () => {
    mockCompliance({ data: undefined });
    render(<ComplianceMatrix />);
    expect(screen.getByTestId('empty-state')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Row rendering
// ---------------------------------------------------------------------------

describe('ComplianceMatrix — row rendering', () => {
  it('renders one row per compliance item', () => {
    mockCompliance({
      data: {
        items: [
          makeRow({ id: 'r1', requirement: 'ISO 27001 certificate' }),
          makeRow({ id: 'r2', requirement: 'GDPR DPA signed' }),
          makeRow({ id: 'r3', requirement: 'Insurance coverage 5M EUR' }),
        ],
        total: 3,
        compliantCount: 0,
        pendingCount: 3,
      },
    });
    render(<ComplianceMatrix />);
    const rows = screen.getAllByTestId('compliance-row');
    expect(rows).toHaveLength(3);
  });

  it('renders the requirement text of each row', () => {
    mockCompliance({
      data: {
        items: [makeRow({ requirement: 'Must be ISO 27001 certified' })],
        total: 1,
        compliantCount: 0,
        pendingCount: 1,
      },
    });
    render(<ComplianceMatrix />);
    expect(screen.getByText('Must be ISO 27001 certified')).toBeDefined();
  });

  it('renders rows for autoFilled items with the AI filled indicator', () => {
    mockCompliance({
      data: {
        items: [
          makeRow({ id: 'r1', autoFilled: true, aiConfidenceBps: 8500 }),
          makeRow({ id: 'r2', autoFilled: false }),
        ],
        total: 2,
        compliantCount: 1,
        pendingCount: 1,
      },
    });
    render(<ComplianceMatrix />);
    // Only the autoFilled row carries the AI indicator in the stub
    const aiIndicators = screen.getAllByTestId('ai-filled-indicator');
    expect(aiIndicators).toHaveLength(1);
  });

  it('does NOT show an AI indicator on rows where autoFilled is false', () => {
    mockCompliance({
      data: {
        items: [makeRow({ autoFilled: false })],
        total: 1,
        compliantCount: 0,
        pendingCount: 1,
      },
    });
    render(<ComplianceMatrix />);
    expect(screen.queryByTestId('ai-filled-indicator')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

describe('ComplianceMatrix — accessibility', () => {
  it('exposes a labelled region when items are present', () => {
    mockCompliance({
      data: {
        items: [makeRow()],
        total: 1,
        compliantCount: 0,
        pendingCount: 1,
      },
    });
    render(<ComplianceMatrix />);
    // The scrollable container has role="region" with an aria-label
    expect(screen.getByRole('region', { name: /compliance.matrixLabel/i })).toBeDefined();
  });

  it('has a list with aria-label for the rows', () => {
    mockCompliance({
      data: {
        items: [makeRow()],
        total: 1,
        compliantCount: 0,
        pendingCount: 1,
      },
    });
    render(<ComplianceMatrix />);
    expect(screen.getByRole('list', { name: /compliance.matrixLabel/i })).toBeDefined();
  });
});

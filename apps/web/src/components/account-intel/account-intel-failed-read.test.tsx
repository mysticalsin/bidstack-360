import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ useAccountIntel: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, string | number>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? '')),
  }),
}));

vi.mock('@/hooks/useAccountIntel', () => ({
  useAccountIntel: m.useAccountIntel,
  useExtractDocument: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteSolution: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteProduct: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/useFiles', () => ({
  useFiles: () => ({ data: { items: [] } }),
}));

vi.mock('@/hooks/useScrollableTabs', () => ({
  useScrollableTabs: () => () => undefined,
}));

import { AccountIntelPanel } from './AccountIntelPanel';

const SOLUTION = {
  id: 'sol_demo_1',
  name: 'Northwind demo solution',
  description: 'A synthetic cloud offer.',
  category: 'cloud',
  status: 'suggested',
  confidenceBps: 8000,
  extractedFromDocumentId: null,
};

function snapshot(solutions: Array<typeof SOLUTION> = []) {
  return { solutions, products: [], extractions: [] };
}

function intel(state: {
  isLoading?: boolean;
  isError?: boolean;
  solutions?: Array<typeof SOLUTION>;
}) {
  const loaded = state.solutions !== undefined;
  m.useAccountIntel.mockReturnValue({
    data: loaded ? snapshot(state.solutions ?? []) : undefined,
    isLoading: state.isLoading ?? false,
    isError: state.isError ?? false,
    error: state.isError ? new Error('account intelligence down') : null,
    refetch: vi.fn(),
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AccountIntelPanel', () => {
  it('does not count a failed account intelligence read as zero', () => {
    // WHY: the account page opens intelligence before the snapshot returns.
    // A failed read has no solutions. The tabs still said Solutions (0).
    intel({ isError: true });
    render(<AccountIntelPanel accountId="acct_demo_1" />);

    expect(screen.queryByText('Solutions (0)')).toBeNull();
    expect(screen.queryByText('Products (0)')).toBeNull();
    expect(screen.queryByText('Extractions (0)')).toBeNull();
    expect(screen.queryByText('No solutions yet')).toBeNull();
    expect(screen.getByText('Account intelligence is not loaded.')).toBeTruthy();
    expect(screen.getByText('Solutions, not loaded')).toBeTruthy();
    expect(screen.getByText('Products, not loaded')).toBeTruthy();
    expect(screen.getByText('Extractions, not loaded')).toBeTruthy();
    expect(screen.getByText('Failed to load')).toBeTruthy();
  });

  it('does not count an account intelligence load in progress as zero', () => {
    // WHY: the counts are not known while the snapshot is still loading.
    intel({ isLoading: true });
    render(<AccountIntelPanel accountId="acct_demo_1" />);

    expect(screen.queryByText('Solutions (0)')).toBeNull();
    expect(screen.queryByText('Products (0)')).toBeNull();
    expect(screen.queryByText('Extractions (0)')).toBeNull();
    expect(screen.queryByText('No solutions yet')).toBeNull();
    expect(screen.getByText('Checking account intelligence.')).toBeTruthy();
    expect(screen.getByText('Solutions, checking')).toBeTruthy();
    expect(screen.queryByText('Failed to load')).toBeNull();
    expect(screen.queryByText('Account intelligence is not loaded.')).toBeNull();
  });

  it('keeps a loaded empty snapshot at zero', () => {
    // WHY: a settled snapshot with no rows is an empty catalog. That count stays.
    intel({ solutions: [] });
    render(<AccountIntelPanel accountId="acct_demo_1" />);

    expect(screen.getByText('Solutions (0)')).toBeTruthy();
    expect(screen.getByText('Products (0)')).toBeTruthy();
    expect(screen.getByText('Extractions (0)')).toBeTruthy();
    expect(screen.getByText('No solutions yet')).toBeTruthy();
    expect(screen.queryByText('Solutions, not loaded')).toBeNull();
    expect(screen.queryByText('Solutions, checking')).toBeNull();
    expect(screen.queryByText('Failed to load')).toBeNull();
  });

  it('keeps a loaded solution', () => {
    // WHY: the demo snapshot still names the solution when the read lands.
    intel({ solutions: [SOLUTION] });
    render(<AccountIntelPanel accountId="acct_demo_1" />);

    expect(screen.getByText('Northwind demo solution')).toBeTruthy();
    expect(screen.getByText('Solutions (1)')).toBeTruthy();
    expect(screen.getByText('Products (0)')).toBeTruthy();
    expect(screen.queryByText('No solutions yet')).toBeNull();
    expect(screen.queryByText('Solutions, not loaded')).toBeNull();
    expect(screen.queryByText('Failed to load')).toBeNull();
  });
});

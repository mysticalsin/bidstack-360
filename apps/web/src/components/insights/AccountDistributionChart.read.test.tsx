// A paused or in-flight company read has no industries yet. A skeleton
// with no status looks like the chart is off. A failed read must stay on
// the error, including when a stale industry is still in memory.
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const chartMocks = vi.hoisted(() => ({
  useInsightCompanies: vi.fn(),
}));

vi.mock('@/components/charts/pie-chart', () => ({
  PieChart: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/charts/pie-slice', () => ({
  PieSlice: () => null,
}));

vi.mock('@/hooks/useInsightsData', () => ({
  useInsightCompanies: chartMocks.useInsightCompanies,
}));

import { AccountDistributionChart } from './AccountDistributionChart';

const CHECKING = 'Checking account distribution. The companies have not arrived.';
const FAILED = 'Could not load account distribution.';
const EMPTY = 'No companies yet';

interface ReadSnapshot {
  data?: unknown;
  isLoading: boolean;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  status: string;
  error?: Error | null;
}

function read(partial: Partial<ReadSnapshot> & Pick<ReadSnapshot, 'status'>): ReadSnapshot {
  return {
    data: undefined,
    isLoading: false,
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    ...partial,
  };
}

const paused = read({ status: 'pending', isPending: true, isLoading: false });
const inflight = read({ status: 'pending', isPending: true, isLoading: true });
const failed = read({ status: 'error', isError: true, error: new Error('offline') });

function renderChart(query: ReadSnapshot) {
  chartMocks.useInsightCompanies.mockReturnValue({ ...query, refetch: vi.fn() });
  return render(<AccountDistributionChart />);
}

describe('AccountDistributionChart read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused company read as empty', () => {
    // WHY: a paused first read has isLoading false and no companies. A
    // skeleton with no status looks off. The companies have not arrived.
    renderChart(paused);

    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.getAllByText(CHECKING).length).toBeGreaterThan(0);
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('does not treat an in-flight company read as empty', () => {
    // WHY: a slow read also has no companies. A skeleton with no status is
    // not a settled empty chart, and it is not a failed load.
    renderChart(inflight);

    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.getAllByText(CHECKING).length).toBeGreaterThan(0);
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('keeps a failed company read on the error', () => {
    // WHY: a failed read is not evidence that no companies exist. The error
    // stays, and an empty chart does not stand in for the read.
    renderChart(failed);

    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(screen.getAllByText(FAILED).length).toBeGreaterThan(0);
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('lets a failed company read win over a stale industry', () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // showing Photonics from a list that is no longer the read.
    renderChart(
      read({
        status: 'error',
        isError: true,
        error: new Error('offline'),
        data: {
          items: [{ industry: 'Photonics' }],
          complete: true,
        },
      }),
    );

    expect(screen.queryByText('Photonics')).toBeNull();
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(screen.getAllByText(FAILED).length).toBeGreaterThan(0);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it('stays empty when a settled company read has no companies', () => {
    // WHY: a read that arrived with no companies stays empty. A slow network
    // must not be dressed up as an empty chart, and this one must.
    renderChart(
      read({
        status: 'success',
        isSuccess: true,
        data: { items: [], complete: true },
      }),
    );

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('stays empty when a settled read has a null payload', () => {
    // WHY: null is a settled payload with nothing in it. Undefined data is
    // unread. Null is not unread, and it is not a failed load.
    renderChart(
      read({
        status: 'success',
        isSuccess: true,
        data: null,
      }),
    );

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows the industry when the company read has arrived', () => {
    // WHY: a loaded industry stays. The unread line must not replace a
    // slice the read already returned.
    renderChart(
      read({
        status: 'success',
        isSuccess: true,
        data: {
          items: [{ industry: 'Photonics' }],
          complete: true,
        },
      }),
    );

    expect(screen.getByText('Photonics')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('still shows Unspecified when a loaded company has no industry', () => {
    // WHY: a blank industry is loaded data, labeled Unspecified. Unread must
    // not look like that label, and the label must not look unread.
    renderChart(
      read({
        status: 'success',
        isSuccess: true,
        data: {
          items: [{ industry: '   ' }],
          complete: true,
        },
      }),
    );

    expect(screen.getByText('Unspecified')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});

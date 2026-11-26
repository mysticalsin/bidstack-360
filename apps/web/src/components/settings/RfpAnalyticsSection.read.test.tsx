// A paused or in-flight analytics read has no rollup yet. The section painted
// zeros and said there were no RFPs yet, which is how a settled empty book looks.
// The rollup has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: hookMocks.useQuery,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

import { RfpAnalyticsSection } from './RfpAnalyticsSection';

const CHECKING = 'Checking RFP analytics. The rollup has not arrived.';
const FAILED = 'Failed to load RFP analytics. Please retry.';

interface Rollup {
  totalCount: number;
  wonCount: number;
  lostCount: number;
  totalValueMicros: string;
  byStatus: Array<{ status: string; count: number }>;
  byOwner: Array<{ ownerId: string | null; ownerName: string; count: number; totalValueMicros: string }>;
}

function rollup(overrides: Partial<Rollup> = {}): Rollup {
  return {
    totalCount: 0,
    wonCount: 0,
    lostCount: 0,
    totalValueMicros: '0',
    byStatus: [],
    byOwner: [],
    ...overrides,
  };
}

function renderSection(read: { data?: unknown; isError?: boolean; status?: string }) {
  hookMocks.useQuery.mockReturnValue({
    data: read.data,
    isError: read.isError ?? false,
    isLoading: false,
    status: read.status ?? 'pending',
    refetch: vi.fn(),
  });
  render(<RfpAnalyticsSection />);
}

describe('RfpAnalyticsSection read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused analytics read as an empty book', () => {
    // WHY: a paused first read has isLoading false and no payload. Zero RFPs
    // and "No RFPs yet" are a settled book. This one has not arrived.
    renderSection({ data: undefined, isError: false, status: 'pending' });

    expect(screen.queryByText('No RFPs yet')).toBeNull();
    expect(screen.queryByText('No owners yet')).toBeNull();
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.queryByText('Total RFPs')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe(CHECKING);
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('does not treat an in-flight analytics read as an empty book', () => {
    // WHY: a slow read also has no payload, and isLoading can stay false.
    // Zeros must not stand in for a read that is still running.
    renderSection({ data: undefined, isError: false, status: 'pending' });

    expect(screen.queryByText('No RFPs yet')).toBeNull();
    expect(screen.queryByText('No owners yet')).toBeNull();
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.queryByText('Total RFPs')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe(CHECKING);
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('keeps a failed analytics read on the error', () => {
    // WHY: a failed read is not an unread pause and not an empty book.
    renderSection({ data: undefined, isError: true, status: 'error' });

    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText('No RFPs yet')).toBeNull();
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.queryByText('Total RFPs')).toBeNull();
  });

  it('lets a failed status win over a stale rollup', () => {
    // WHY: error wins before a payload. A refetch failure must not keep the
    // previous totals when isError is still false.
    renderSection({
      data: rollup({
        totalCount: 8,
        byOwner: [{ ownerId: 'stale', ownerName: 'Stale owner', count: 8, totalValueMicros: '0' }],
      }),
      isError: false,
      status: 'error',
    });

    expect(screen.queryByText('Stale owner')).toBeNull();
    expect(screen.queryByText('8')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText('Total RFPs')).toBeNull();
  });

  it('drops a stale rollup when the read is in error', () => {
    // WHY: isError wins even when a previous rollup is still in data.
    // That rollup is not the settled book.
    renderSection({
      data: rollup({
        totalCount: 8,
        byOwner: [{ ownerId: 'stale', ownerName: 'Stale owner', count: 8, totalValueMicros: '0' }],
      }),
      isError: true,
      status: 'error',
    });

    expect(screen.queryByText('Stale owner')).toBeNull();
    expect(screen.queryByText('8')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('stays on the empty book when a settled payload is null', () => {
    // WHY: null has arrived. Undefined data is unread. A null payload is
    // not a failed load, and it is not still checking.
    renderSection({ data: null, isError: false, status: 'success' });

    expect(screen.getByText('No RFPs yet')).toBeTruthy();
    expect(screen.getByText('No owners yet')).toBeTruthy();
    expect(screen.getByText('Total RFPs')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('stays empty when a settled rollup has no RFPs', () => {
    // WHY: a zero book has arrived. Unread must not replace that settled
    // miss, and the miss must not say the load failed.
    renderSection({ data: rollup(), isError: false, status: 'success' });

    expect(screen.getByText('No RFPs yet')).toBeTruthy();
    expect(screen.getByText('No owners yet')).toBeTruthy();
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('shows a loaded rollup, including a blank owner name', () => {
    // WHY: a loaded rollup is the book. Unread must not drop it, and a
    // blank owner name is still a loaded row.
    renderSection({
      data: rollup({
        totalCount: 4,
        wonCount: 1,
        lostCount: 1,
        totalValueMicros: '2000000',
        byStatus: [{ status: 'draft', count: 2 }],
        byOwner: [
          { ownerId: 'named', ownerName: 'Northwind', count: 3, totalValueMicros: '2000000' },
          { ownerId: null, ownerName: '', count: 1, totalValueMicros: '0' },
        ],
      }),
      isError: false,
      status: 'success',
    });

    expect(screen.getByText('Northwind')).toBeTruthy();
    expect(screen.getByText('Draft')).toBeTruthy();
    const ownerCells = screen.getAllByRole('cell').map((cell) => cell.textContent);
    expect(ownerCells).toContain('');
    expect(ownerCells).toContain('Northwind');
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.queryByText('No RFPs yet')).toBeNull();
  });
});

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IntelImportBatchView } from '@bidstack/shared';

const hookMocks = vi.hoisted(() => ({
  useIntelImports: vi.fn(),
}));

vi.mock('@/hooks/useCompanyIntelSummary', () => ({
  useIntelImports: hookMocks.useIntelImports,
}));

import { IntelImportProgress } from './IntelImportProgress';

const UNREAD = 'Import enrichment has not arrived.';
const READ_FAILED = 'Could not load import enrichment. It has not arrived.';

function batch(status: IntelImportBatchView['status']): IntelImportBatchView {
  const complete = status === 'complete';
  return {
    id: 'batch-1',
    migrationJobId: null,
    origin: 'csv',
    total: 4,
    done: complete ? 3 : 1,
    failed: complete ? 1 : 0,
    status,
    summary: complete
      ? { withRevenue: 2, withHeadcountGrowth: 1, withNewRoles30d: 0 }
      : {},
    createdAt: '2026-11-07T12:00:00.000Z',
    completedAt: complete ? '2026-11-07T12:05:00.000Z' : null,
  };
}

describe('IntelImportProgress read honesty', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not call an in-flight enrichment read an empty import list', () => {
    // WHY: the companies page passes data?.items ?? []. Until the payload
    // arrives that array is empty, and an empty list hides the row. The
    // operator then thinks enrichment is finished or that the import created
    // nothing to enrich.
    hookMocks.useIntelImports.mockReturnValue({
      data: undefined,
      isLoading: true,
      isPending: true,
      isFetching: true,
      isError: false,
    });

    render(<IntelImportProgress batches={[]} />);

    expect(screen.getByRole('status').textContent).toBe(UNREAD);
    expect(screen.queryByLabelText('Import enrichment')).toBeNull();
    expect(screen.queryByText(/enriched/)).toBeNull();
  });

  it('does not call a paused enrichment read an empty import list', () => {
    // WHY: a paused query is not loading and has no payload. Collapsing that
    // to [] still renders nothing, which reads as "no imports".
    hookMocks.useIntelImports.mockReturnValue({
      data: undefined,
      isLoading: false,
      isPending: true,
      isFetching: false,
      isError: false,
    });

    render(<IntelImportProgress batches={[]} />);

    expect(screen.getByRole('status').textContent).toBe(UNREAD);
    expect(screen.queryByText('CSV import')).toBeNull();
  });

  it('does not call a failed enrichment read an empty or finished import', () => {
    // WHY: a failed GET is not "no recent imports" and it is not a completed
    // enrichment. Silence here looks like the book is done.
    hookMocks.useIntelImports.mockReturnValue({
      data: undefined,
      isLoading: false,
      isPending: false,
      isFetching: false,
      isError: true,
    });

    render(<IntelImportProgress batches={[]} />);

    expect(screen.getByRole('alert').textContent).toBe(READ_FAILED);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText(/enriched/)).toBeNull();
    expect(screen.queryByText('CSV import')).toBeNull();
  });

  it('does not keep a stale complete batch on screen after the read fails', () => {
    // WHY: a later poll can fail while the last payload still says complete.
    // The check mark and the revenue line would say enrichment finished.
    const done = batch('complete');
    hookMocks.useIntelImports.mockReturnValue({
      data: { items: [done] },
      isLoading: false,
      isPending: false,
      isFetching: false,
      isError: true,
    });

    render(<IntelImportProgress batches={[done]} />);

    expect(screen.getByRole('alert').textContent).toBe(READ_FAILED);
    expect(screen.queryByText('CSV import')).toBeNull();
    expect(screen.queryByText(/with revenue/)).toBeNull();
    expect(screen.queryByText('4 of 4 enriched')).toBeNull();
  });

  it('stays quiet once a settled read says there are no recent imports', () => {
    // WHY: an arrived empty list is a real "nothing enriching", not a missing read.
    hookMocks.useIntelImports.mockReturnValue({
      data: { items: [] },
      isLoading: false,
      isPending: false,
      isFetching: false,
      isError: false,
    });

    render(<IntelImportProgress batches={[]} />);

    expect(screen.queryByText(UNREAD)).toBeNull();
    expect(screen.queryByText(READ_FAILED)).toBeNull();
    expect(screen.queryByLabelText('Import enrichment')).toBeNull();
  });

  it('still shows a settled running import', () => {
    const running = batch('running');
    hookMocks.useIntelImports.mockReturnValue({
      data: { items: [running] },
      isLoading: false,
      isPending: false,
      isFetching: false,
      isError: false,
    });

    render(<IntelImportProgress batches={[running]} />);

    expect(screen.getByText('CSV import')).toBeTruthy();
    expect(screen.getByText('1 of 4 enriched')).toBeTruthy();
    expect(screen.queryByText(UNREAD)).toBeNull();
    expect(screen.queryByText(READ_FAILED)).toBeNull();
  });

  it('still shows a settled complete import', () => {
    const done = batch('complete');
    hookMocks.useIntelImports.mockReturnValue({
      data: { items: [done] },
      isLoading: false,
      isPending: false,
      isFetching: true,
      isError: false,
    });

    render(<IntelImportProgress batches={[done]} />);

    expect(screen.getByText('CSV import')).toBeTruthy();
    expect(screen.getByText('4 of 4 enriched')).toBeTruthy();
    expect(screen.getByText(/2 with revenue/)).toBeTruthy();
    expect(screen.queryByText(UNREAD)).toBeNull();
    expect(screen.queryByText(READ_FAILED)).toBeNull();
  });
});

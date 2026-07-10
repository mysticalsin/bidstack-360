// Merge-safety contract for the review dialog: a merge fires ONLY after an
// explicit survivor choice plus a confirm, targets exactly the other records
// in that cluster, and never sends the survivor as its own duplicate.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DuplicatesDialog } from './DuplicatesDialog';
import {
  useCompanyDuplicates,
  useContactDuplicates,
  useMergeDuplicates,
  type CompanyDuplicateRecord,
} from '@/hooks/useDuplicates';
import { confirm } from '@/components/ui/ConfirmDialog';

vi.mock('@/hooks/useDuplicates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useDuplicates')>()),
  useCompanyDuplicates: vi.fn(),
  useContactDuplicates: vi.fn(),
  useMergeDuplicates: vi.fn(),
}));
vi.mock('@/components/ui/ConfirmDialog', () => ({ confirm: vi.fn() }));
vi.mock('@/components/ui/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const mutateAsync = vi.fn(async () => ({}));

function company(id: string, name: string, domain: string): CompanyDuplicateRecord {
  return {
    id,
    name,
    legalName: null,
    domain,
    website: null,
    industry: 'Rail',
    countryCode: 'FR',
    createdAt: '2026-05-01T00:00:00.000Z',
    contactCount: 2,
    opportunityCount: 1,
  };
}

const oneCluster = {
  clusters: [
    {
      reasons: ['name', 'domain'],
      companies: [
        company('a', 'Helios Rail', 'helios.example'),
        company('b', 'HELIOS Rail', 'helios.example'),
        company('c', 'Helios Rail SAS', 'helios.example'),
      ],
    },
  ],
  scanned: 3,
  truncated: false,
};

function mockQueries(data: typeof oneCluster | undefined, opts?: { pending?: boolean; error?: boolean }) {
  const state = {
    data,
    isPending: opts?.pending ?? false,
    isError: opts?.error ?? false,
    refetch: vi.fn(),
  };
  vi.mocked(useCompanyDuplicates).mockReturnValue(state as never);
  vi.mocked(useContactDuplicates).mockReturnValue({
    data: undefined,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  } as never);
  vi.mocked(useMergeDuplicates).mockReturnValue({ mutateAsync } as never);
}

function renderDialog() {
  return render(
    <DuplicatesDialog entity="company" open onOpenChange={() => undefined} />,
  );
}

describe('DuplicatesDialog', () => {
  beforeEach(() => {
    mutateAsync.mockClear();
    vi.mocked(confirm).mockReset();
  });

  it('shows every cluster record side-by-side with the match reason', () => {
    mockQueries(oneCluster);
    renderDialog();
    expect(screen.getByText('Helios Rail')).toBeDefined();
    expect(screen.getByText('HELIOS Rail')).toBeDefined();
    expect(screen.getByText('Helios Rail SAS')).toBeDefined();
    expect(screen.getByText('Same normalized name')).toBeDefined();
    expect(screen.getByText('Same domain')).toBeDefined();
  });

  it('merges nothing when the confirm is cancelled — survivor choice must be deliberate', async () => {
    mockQueries(oneCluster);
    vi.mocked(confirm).mockResolvedValue(false);
    renderDialog();
    fireEvent.click(screen.getAllByRole('button', { name: /^Keep/ })[0]!);
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('after confirm, merges exactly the other records into the chosen survivor', async () => {
    mockQueries(oneCluster);
    vi.mocked(confirm).mockResolvedValue(true);
    renderDialog();
    // Choose the SECOND record ('b') so the test fails if the component
    // hardcodes the first record as survivor.
    fireEvent.click(screen.getAllByRole('button', { name: /^Keep/ })[1]!);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
    expect(mutateAsync).toHaveBeenCalledWith({
      entity: 'company',
      survivorId: 'b',
      duplicateId: 'a',
    });
    expect(mutateAsync).toHaveBeenCalledWith({
      entity: 'company',
      survivorId: 'b',
      duplicateId: 'c',
    });
    // The survivor must never be merged into itself.
    for (const call of mutateAsync.mock.calls as unknown as Array<[{ duplicateId: string }]>) {
      expect(call[0].duplicateId).not.toBe('b');
    }
  });

  it('shows the bid-specific zero state when the org is clean', () => {
    mockQueries({ clusters: [], scanned: 40, truncated: false });
    renderDialog();
    expect(screen.getByText('Every account resolves cleanly')).toBeDefined();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('shows a skeleton while scanning and an actionable error state on failure', () => {
    mockQueries(undefined, { pending: true });
    const { unmount } = renderDialog();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    unmount();

    mockQueries(undefined, { error: true });
    renderDialog();
    expect(screen.getByText('The duplicate scan failed')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Scan again' })).toBeDefined();
  });
});

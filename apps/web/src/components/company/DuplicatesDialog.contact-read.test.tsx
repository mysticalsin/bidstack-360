// A contact duplicate scan that has not arrived is not a clean book.
// "Every contact is one person" is only honest after the payload lands empty.
// A paused or failed read still has no clusters, and that zero is not a result.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DuplicatesDialog } from './DuplicatesDialog';
import {
  useCompanyDuplicates,
  useContactDuplicates,
  useMergeDuplicates,
  type ContactDuplicateRecord,
  type ContactDuplicatesPayload,
} from '@/hooks/useDuplicates';

vi.mock('@/hooks/useDuplicates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useDuplicates')>()),
  useCompanyDuplicates: vi.fn(),
  useContactDuplicates: vi.fn(),
  useMergeDuplicates: vi.fn(),
}));
vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: () => true,
}));

const ADA_EMAIL = 'ada@example.com';

function ada(): ContactDuplicateRecord {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Ada Example',
    email: ADA_EMAIL,
    role: 'Buyer',
    phone: null,
    customer: 'Example Co',
    companyName: 'Example Co',
    createdAt: '2026-05-01T00:00:00.000Z',
    opportunityLinkCount: 1,
  };
}

function payload(
  clusters: ContactDuplicatesPayload['clusters'],
): ContactDuplicatesPayload {
  return { clusters, scanned: clusters.length, truncated: false };
}

function mockScan(state: {
  data?: ContactDuplicatesPayload;
  isPending?: boolean;
  isLoading?: boolean;
  isError?: boolean;
  error?: Error | null;
}) {
  vi.mocked(useCompanyDuplicates).mockReturnValue({
    data: undefined,
    isPending: true,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  } as never);
  vi.mocked(useContactDuplicates).mockReturnValue({
    data: state.data,
    isPending: state.isPending ?? false,
    isLoading: state.isLoading ?? false,
    isError: state.isError ?? false,
    error: state.error ?? null,
    refetch: vi.fn(),
  } as never);
  vi.mocked(useMergeDuplicates).mockReturnValue({ mutateAsync: vi.fn() } as never);
}

function renderScan() {
  return render(<DuplicatesDialog entity="contact" open onOpenChange={() => undefined} />);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('contact duplicate scan read', () => {
  it('keeps the first fetch on a skeleton instead of a clean book', () => {
    // WHY: the dialog just opened. No clusters have arrived, so a clean
    // book would tell the reader the scan already finished empty.
    mockScan({ data: undefined, isPending: true, isLoading: true });

    renderScan();

    expect(screen.queryByRole('heading', { name: 'Every contact is one person' })).toBeNull();
    expect(screen.queryByText('Checking duplicate contacts. They have not arrived.')).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it('does not call a missing duplicate scan a clean book', () => {
    // WHY: a paused read is pending without isLoading, and a caller can
    // also hand over no payload with both flags false. Either way the
    // clusters have not arrived. "Every contact is one person" would say
    // the book was scanned and came back clean.
    mockScan({ data: undefined, isPending: false, isLoading: false });

    renderScan();

    expect(screen.queryByRole('heading', { name: 'Every contact is one person' })).toBeNull();
    expect(screen.getByRole('status').textContent).toBe(
      'Checking duplicate contacts. They have not arrived.',
    );
    expect(screen.queryByRole('heading', { name: 'Ada Example' })).toBeNull();
  });

  it('does not call a failed duplicate scan a clean book', () => {
    // WHY: the scan failed. Ada Example may still share an email with a
    // twin. A clean book would hide that, and the error has to say the
    // contacts have not arrived.
    mockScan({
      data: undefined,
      isPending: false,
      isLoading: false,
      isError: true,
      error: new Error('offline'),
    });

    renderScan();

    expect(screen.getByRole('heading', { name: 'The duplicate scan failed' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/offline/);
    expect(screen.getByRole('alert').textContent).toMatch(
      /The contact duplicates have not arrived\./,
    );
    expect(screen.queryByRole('heading', { name: 'Every contact is one person' })).toBeNull();
  });

  it('says the book is clean only after an empty payload arrives', () => {
    // WHY: a finished scan with zero clusters is the clean book. Hiding
    // that line would make a real empty result look like a scan that
    // never ended.
    mockScan({
      data: payload([]),
      isPending: false,
      isLoading: false,
    });

    renderScan();

    expect(screen.getByRole('heading', { name: 'Every contact is one person' })).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows Ada Example once the duplicate cluster has arrived', () => {
    // WHY: a settled cluster is the scan. The clean-book line stays
    // reserved for a payload that arrived empty.
    mockScan({
      data: payload([{ reasons: ['email'], contacts: [ada(), { ...ada(), id: '22222222-2222-4222-8222-222222222222', name: 'Ada Example Twin' }] }]),
      isPending: false,
      isLoading: false,
    });

    renderScan();

    expect(screen.getByRole('heading', { name: 'Ada Example', exact: true })).toBeTruthy();
    expect(screen.getAllByText(ADA_EMAIL).length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: 'Every contact is one person' })).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

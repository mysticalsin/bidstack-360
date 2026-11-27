// A deal documents tab may say "No documents attached" only after the file
// list arrives. Omitting the list, or marking the read failed, used to fall
// through the empty default and tell the reader the bid has no files.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/lib/api', () => ({
  api: vi.fn().mockResolvedValue({ items: [] }),
}));

vi.mock('@/components/signatures/SendForSignatureModal', () => ({
  SendForSignatureModal: () => null,
}));

import { OpportunityTabs } from './OpportunityTabs';

const EMPTY = 'No documents attached';
const CHECKING = 'Checking documents';
const NOT_ARRIVED = 'The file list has not arrived.';
const LOAD_ERROR = "Couldn't load documents";
const NOT_LOADED = 'The file list did not load.';
const ZERO = '0 files';
const FILE_NAME = 'Northwind-61520.pdf';

type DealFile = { id: string; name: string; kind: string; bytes: number | null };

function renderDocuments(props: { documents?: DealFile[]; documentsFailed?: boolean } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <OpportunityTabs oppId="opp-1" customer="Northwind Demo" {...props} />
    </QueryClientProvider>,
  );
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Documents' }));
}

describe('deal documents read', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not call a missing file list an empty bid', () => {
    // WHY: the tab defaulted documents to [] before the payload arrived, so a
    // reader saw "No documents attached" and "0 files" for a read that had
    // not happened. 61520 is the file that would have been on the bid.
    renderDocuments();

    expect(screen.queryByRole('heading', { name: EMPTY })).toBeNull();
    expect(screen.queryByText(ZERO)).toBeNull();
    expect(screen.queryByText(/\bnone\b/i)).toBeNull();
    expect(screen.queryByText(FILE_NAME)).toBeNull();
    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expect(screen.getByRole('status').textContent).toContain(NOT_ARRIVED);
  });

  it('does not call a failed file read an empty bid', () => {
    renderDocuments({ documentsFailed: true });

    expect(screen.queryByRole('heading', { name: EMPTY })).toBeNull();
    expect(screen.queryByText(ZERO)).toBeNull();
    expect(screen.queryByText(/\bnone\b/i)).toBeNull();
    expect(screen.queryByText(FILE_NAME)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.getByRole('heading', { name: LOAD_ERROR })).toBeTruthy();
    expect(screen.getByText(NOT_LOADED)).toBeTruthy();
  });

  it('still says the bid has no files after a settled empty list', () => {
    renderDocuments({ documents: [] });

    expect(screen.getByRole('heading', { name: EMPTY })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('heading', { name: LOAD_ERROR })).toBeNull();
  });

  it('still shows a file once the list has arrived', () => {
    renderDocuments({
      documents: [{ id: 'doc-61520', name: FILE_NAME, kind: 'proposal', bytes: 61520 }],
    });

    expect(screen.getByText(FILE_NAME)).toBeTruthy();
    expect(screen.getByText(/60\.1 KB/)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: EMPTY })).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('heading', { name: LOAD_ERROR })).toBeNull();
  });
});

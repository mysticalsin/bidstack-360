// The extractions tab may say "No documents" only after the file list arrives.
// A paused or in-flight read has no payload and isLoading false. That must not
// look like an empty library. A failed status must not keep a stale file name.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const EMPTY = 'No documents';
const CHECKING = 'Checking documents. The file list has not arrived.';
const FAILED = "Couldn't load documents. The file list did not load.";
const FILE = 'Northwind-61520.pdf';

const files = vi.hoisted(() => ({
  current: {
    data: undefined as { items: Array<{ id: string; name: string }> } | null | undefined,
    isLoading: false,
    isError: false,
    status: 'pending' as string,
    error: undefined as Error | undefined,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, values?: Record<string, string | number>) => {
      const text = fallback ?? _key;
      if (!values) return text;
      return text.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values[name] ?? ''));
    },
  }),
}));

vi.mock('@/hooks/useAccountIntel', () => ({
  useAccountIntel: () => ({
    data: { solutions: [], products: [], extractions: [] },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useExtractDocument: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteSolution: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteProduct: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/useFiles', () => ({
  useFiles: () => files.current,
}));

vi.mock('@/hooks/useScrollableTabs', () => ({
  useScrollableTabs: () => () => undefined,
}));

import { AccountIntelPanel } from './AccountIntelPanel';

function openExtractions() {
  render(<AccountIntelPanel accountId="acct_demo_1" />);
  fireEvent.click(screen.getByRole('tab', { name: 'Extractions (0)' }));
}

function unread() {
  files.current = {
    data: undefined,
    isLoading: false,
    isError: false,
    status: 'pending',
    error: undefined,
  };
}

describe('document extraction file list', () => {
  afterEach(() => {
    cleanup();
    unread();
  });

  it('does not treat a paused file read as an empty document list', () => {
    // WHY: the extractions tab painted "No documents" while GET /api/files
    // was still paused. 61520 is the file that would have been on the account.
    unread();
    openExtractions();
    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expect(screen.queryByRole('heading', { name: EMPTY })).toBeNull();
    expect(screen.queryByText(FILE)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not treat an in-flight file read as an empty document list', () => {
    files.current = {
      data: undefined,
      isLoading: false,
      isError: false,
      status: 'pending',
      error: undefined,
    };
    openExtractions();
    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expect(screen.queryByRole('heading', { name: EMPTY })).toBeNull();
    expect(screen.queryByText(FILE)).toBeNull();
  });

  it('keeps a failed file read on the error when isError is true', () => {
    files.current = {
      data: undefined,
      isLoading: false,
      isError: true,
      status: 'error',
      error: new Error('offline'),
    };
    openExtractions();
    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByRole('heading', { name: EMPTY })).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FILE)).toBeNull();
  });

  it('drops a stale file when the read status is error and isError is still false', () => {
    files.current = {
      data: { items: [{ id: 'file-61520', name: FILE }] },
      isLoading: false,
      isError: false,
      status: 'error',
      error: undefined,
    };
    openExtractions();
    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByText(FILE)).toBeNull();
    expect(screen.queryByRole('heading', { name: EMPTY })).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('still says there are no documents when the list arrived empty', () => {
    files.current = {
      data: { items: [] },
      isLoading: false,
      isError: false,
      status: 'success',
      error: undefined,
    };
    openExtractions();
    expect(screen.getByRole('heading', { name: EMPTY })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still shows a file that arrived', () => {
    files.current = {
      data: { items: [{ id: 'file-61520', name: FILE }] },
      isLoading: false,
      isError: false,
      status: 'success',
      error: undefined,
    };
    openExtractions();
    expect(screen.getByText(FILE)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: EMPTY })).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('treats a settled null payload as an empty list', () => {
    files.current = {
      data: null,
      isLoading: false,
      isError: false,
      status: 'success',
      error: undefined,
    };
    openExtractions();
    expect(screen.getByRole('heading', { name: EMPTY })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

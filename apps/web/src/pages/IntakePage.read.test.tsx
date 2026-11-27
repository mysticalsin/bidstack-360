import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The file list is a React Query read. A paused or in-flight read has no payload
// and isLoading false. That must not look like a settled empty folder, a ready
// dropzone, or a failed load. A failed read must not keep a stale file name.
const CHECKING = 'Checking documents. The file list has not arrived.';
const EMPTY = 'No documents yet';
const FAILED = 'Failed to load files';
const FILE = 'Northwind.pdf';

const files = vi.hoisted(() => ({
  current: {
    data: undefined as { items: Array<{ id: string; name: string; contentType: string; bytes: number }> } | null | undefined,
    isLoading: false,
    isError: false,
    status: 'pending' as string,
    fetchStatus: 'paused' as string,
    error: undefined as Error | undefined,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

vi.mock('@/hooks/useFiles', () => ({
  useFiles: () => files.current,
  useUploadFile: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/useAccountIntel', () => ({
  useAccountIntel: () => ({ data: undefined, isError: false, status: 'pending' }),
  useExtractDocument: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/useCompanies', () => ({
  useCompanies: () => ({ data: { items: [] }, isLoading: false, isError: false, status: 'success' }),
}));

import { IntakePage } from './IntakePage';

function renderIntake(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <IntakePage />
    </MemoryRouter>,
  );
}

function unread(fetchStatus: string) {
  files.current = {
    data: undefined,
    isLoading: false,
    isError: false,
    status: 'pending',
    fetchStatus,
    error: undefined,
  };
}

describe('intake file list read', () => {
  afterEach(() => {
    cleanup();
    unread('paused');
  });

  it('does not treat a paused file read as an empty folder or a ready dropzone', () => {
    unread('paused');
    renderIntake('/intake?account=acc-1');
    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(/Drag & drop/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not treat an in-flight file read as an empty folder or a ready dropzone', () => {
    unread('fetching');
    renderIntake('/intake?account=acc-1');
    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(/Drag & drop/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps a failed file read on the error when isError is true', () => {
    files.current = {
      data: undefined,
      isLoading: false,
      isError: true,
      status: 'error',
      fetchStatus: 'idle',
      error: new Error('offline'),
    };
    renderIntake('/intake?account=acc-1');
    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('drops a stale file when the read status is error and isError is still false', () => {
    files.current = {
      data: { items: [{ id: 'file-1', name: FILE, contentType: 'application/pdf', bytes: 1200 }] },
      isLoading: false,
      isError: false,
      status: 'error',
      fetchStatus: 'idle',
      error: undefined,
    };
    renderIntake('/intake?account=acc-1');
    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByText(FILE)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('still says there are no documents when the list arrived empty', () => {
    files.current = {
      data: { items: [] },
      isLoading: false,
      isError: false,
      status: 'success',
      fetchStatus: 'idle',
      error: undefined,
    };
    renderIntake('/intake?account=acc-1');
    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still shows a file that arrived', () => {
    files.current = {
      data: { items: [{ id: 'file-1', name: FILE, contentType: 'application/pdf', bytes: 1200 }] },
      isLoading: false,
      isError: false,
      status: 'success',
      fetchStatus: 'idle',
      error: undefined,
    };
    renderIntake('/intake?account=acc-1');
    expect(screen.getByText(FILE)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still asks for an account when no file read has been started', () => {
    unread('idle');
    renderIntake('/intake');
    expect(screen.getByText('Choose an account to begin')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it('treats a settled null payload as an empty list', () => {
    files.current = {
      data: null,
      isLoading: false,
      isError: false,
      status: 'success',
      fetchStatus: 'idle',
      error: undefined,
    };
    renderIntake('/intake?account=acc-1');
    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

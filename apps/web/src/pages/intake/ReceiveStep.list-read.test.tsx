// A paused or in-flight document list has no payload yet. The step used
// a blank list, the same shape as a missing intake. The documents have not
// arrived, so that blank is not a finding.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { useFiles } from '@/hooks/useFiles';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
  }),
}));

vi.mock('@/hooks/useFiles', () => ({
  useUploadFile: () => ({ isPending: false, mutate: vi.fn() }),
}));

import { ReceiveStep } from './ReceiveStep';

const CHECKING = 'Checking documents. The list has not arrived.';
const EMPTY = 'No documents yet';
const FAILED = 'Failed to load files';
const FILE_NAME = 'Scope.pdf';

type FilesQuery = ReturnType<typeof useFiles>;

function filesQuery(partial: Partial<FilesQuery>): FilesQuery {
  return partial as FilesQuery;
}

function renderStep(files: FilesQuery) {
  return render(
    <ReceiveStep
      accountId="acct-1"
      files={files}
      selectedDocs={new Set()}
      onToggle={vi.fn()}
      onNext={vi.fn()}
      onSelectAccount={vi.fn()}
    />,
  );
}

function expectNoSettledEmpty() {
  expect(screen.queryByText(EMPTY)).toBeNull();
  expect(screen.queryByText(FILE_NAME)).toBeNull();
  expect(screen.queryByText(FAILED)).toBeNull();
}

const LOADED = {
  id: '11111111-1111-4111-8111-111111111111',
  accountId: 'acct-1',
  name: FILE_NAME,
  contentType: 'application/pdf',
  bytes: 2048,
  storageKey: 'uploads/scope.pdf',
  uploadedByUserId: null,
  uploadedByEmail: null,
  createdAt: '2026-11-01T15:00:00.000Z',
};

describe('ReceiveStep unread document list', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not call a paused document read an empty list', async () => {
    // WHY: a paused first read has isLoading false and no payload. The step
    // rendered no list status, while the documents have not arrived.
    renderStep(
      filesQuery({
        data: undefined,
        isError: false,
        isLoading: false,
        status: 'pending',
        fetchStatus: 'paused',
      }),
    );

    expect(await screen.findByText(CHECKING)).toBeTruthy();
    expectNoSettledEmpty();
  });

  it('does not call an in-flight document read an empty list', async () => {
    // WHY: a slow read showed only the loading shimmer. A list that has not
    // arrived is not an intake with no documents.
    renderStep(
      filesQuery({
        data: undefined,
        isError: false,
        isLoading: true,
        status: 'pending',
        fetchStatus: 'fetching',
      }),
    );

    expect(await screen.findByText(CHECKING)).toBeTruthy();
    expectNoSettledEmpty();
    expect(screen.queryByLabelText('Loading...')).toBeNull();
  });

  it('does not call a failed document read an empty list', async () => {
    // WHY: a failed read is not evidence that the account has no documents.
    // The error stays, and the step does not say the list is empty.
    renderStep(
      filesQuery({
        data: undefined,
        isError: true,
        isLoading: false,
        status: 'error',
        fetchStatus: 'idle',
        error: new Error('offline'),
      }),
    );

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(FILE_NAME)).toBeNull();
  });

  it('still shows a settled account that has no documents', async () => {
    // WHY: an account that arrived with no documents is empty. That sentence
    // stays, so a real empty list is not dressed up as a slow network.
    renderStep(
      filesQuery({
        data: { items: [] },
        isError: false,
        isLoading: false,
        status: 'success',
        fetchStatus: 'idle',
      }),
    );

    expect(await screen.findByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(FILE_NAME)).toBeNull();
  });

  it('still shows a document that has arrived', async () => {
    // WHY: a loaded document stays on the list. The unread line must not
    // replace a file the read already returned.
    renderStep(
      filesQuery({
        data: { items: [LOADED] },
        isError: false,
        isLoading: false,
        status: 'success',
        fetchStatus: 'idle',
      }),
    );

    expect(await screen.findByText(FILE_NAME)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

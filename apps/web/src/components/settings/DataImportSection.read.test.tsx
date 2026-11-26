// A paused or in-flight import history has no jobs yet. The data import
// settings tab has nowhere to put that list, so a workspace with imports
// reads as none. That read has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  useMigrations: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/components/import/CsvImportWizard', () => ({
  CsvImportWizard: () => <div>CSV import wizard</div>,
}));

vi.mock('@/components/sync/SyncNowControl', () => ({
  SyncNowControl: () => <div>HubSpot sync</div>,
}));

vi.mock('@/hooks/useMigrations', () => ({
  useMigrations: hookMocks.useMigrations,
}));

import { DataImportSection } from './DataImportSection';

const CHECKING = 'Checking recent imports. The list has not arrived.';
const FAILED = 'Could not load recent imports. The list has not arrived.';
const NONE = 'No imports yet.';
const IMPORTED = 'Imported';

function completeJob() {
  return {
    id: '00000000-0000-4000-8000-000000000004',
    source: 'CSV',
    status: 'COMPLETE',
    processedRows: 4,
    totalRows: 4,
    stalled: false,
  };
}

function renderSection(query: {
  data?: unknown;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  status?: string;
  error?: Error | null;
}) {
  hookMocks.useMigrations.mockReturnValue(query);
  render(<DataImportSection />);
}

describe('Data import settings history read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused import history as no imports', () => {
    // WHY: a paused first read has isLoading false and no list. No imports
    // yet says the list arrived. This one has not.
    renderSection({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'pending',
      error: null,
    });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(NONE)).toBeNull();
    expect(screen.queryByText(IMPORTED)).toBeNull();
    expect(screen.queryByText('4 / 4')).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('does not treat an in-flight import history as no imports', () => {
    // WHY: a slow read also has no list, and isLoading can stay false.
    // No imports yet must not stand in for a read that is still running.
    renderSection({
      data: undefined,
      isLoading: false,
      isFetching: true,
      isError: false,
      status: 'pending',
      error: null,
    });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(NONE)).toBeNull();
    expect(screen.queryByText(IMPORTED)).toBeNull();
    expect(screen.queryByText('4 / 4')).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('keeps a failed import history on the error', () => {
    // WHY: a failed read is not an unread pause. Checking must not stand in
    // for the error, and No imports yet must not open.
    renderSection({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      status: 'error',
      error: new Error('imports down'),
    });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(NONE)).toBeNull();
    expect(screen.queryByText(IMPORTED)).toBeNull();
    expect(screen.queryByText('4 / 4')).toBeNull();
  });

  it('lets a failed read win over a stale imported job', () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // Imported or the finished row count.
    renderSection({
      data: [completeJob()],
      isLoading: false,
      isFetching: false,
      isError: true,
      status: 'error',
      error: new Error('imports down'),
    });

    expect(screen.queryByText(IMPORTED)).toBeNull();
    expect(screen.queryByText('4 / 4')).toBeNull();
    expect(screen.queryByText(NONE)).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('lets a failed status win when isError is still false', () => {
    // WHY: error wins even when the flag has not flipped. A status of error
    // must not keep the stale imported row, and it must not look like none.
    renderSection({
      data: [completeJob()],
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'error',
      error: new Error('imports down'),
    });

    expect(screen.queryByText(IMPORTED)).toBeNull();
    expect(screen.queryByText('4 / 4')).toBeNull();
    expect(screen.queryByText(NONE)).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('stays on no imports when a settled payload is null', () => {
    // WHY: null has arrived. Undefined data is unread. A null payload is not
    // a failed load, and it is not still checking.
    renderSection({
      data: null,
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByText(NONE)).toBeTruthy();
    expect(screen.queryByText(IMPORTED)).toBeNull();
    expect(screen.queryByText('4 / 4')).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('stays on no imports when a settled list is empty', () => {
    // WHY: an empty list has arrived. Unread must not replace that settled
    // miss, and the miss must not say the load failed.
    renderSection({
      data: [],
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByText(NONE)).toBeTruthy();
    expect(screen.queryByText(IMPORTED)).toBeNull();
    expect(screen.queryByText('4 / 4')).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a loaded import that is still running', () => {
    // WHY: a loaded running job stays. Unread must not drop it, and a job
    // that is still running must not say it was imported.
    renderSection({
      data: [
        {
          id: '00000000-0000-4000-8000-000000000002',
          source: 'CSV',
          status: 'RUNNING',
          processedRows: 1,
          totalRows: 4,
          stalled: false,
        },
      ],
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByText('Importing')).toBeTruthy();
    expect(screen.getByText('1 / 4')).toBeTruthy();
    expect(screen.getByText('CSV')).toBeTruthy();
    expect(screen.queryByText(IMPORTED)).toBeNull();
    expect(screen.queryByText(NONE)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a loaded import that finished', () => {
    // WHY: a loaded complete job stays. The unread line must not replace
    // Imported and the row count the read already returned.
    renderSection({
      data: [completeJob()],
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByText(IMPORTED)).toBeTruthy();
    expect(screen.getByText('4 / 4')).toBeTruthy();
    expect(screen.getByText('CSV')).toBeTruthy();
    expect(screen.queryByText(NONE)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});

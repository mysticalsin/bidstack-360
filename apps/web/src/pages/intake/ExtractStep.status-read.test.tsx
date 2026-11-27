// A paused or in-flight extraction read has no status rows. The step invented
// Queued for every selected document. That badge is a status the payload
// never sent. A failed read is not a queue, and a settled empty list is empty.
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const intel = vi.hoisted(() => ({
  current: {
    data: undefined as
      | {
          extractions: Array<{ documentId: string; status: string; error: string | null }>;
        }
      | null
      | undefined,
    isError: false,
    isLoading: false,
    status: 'pending' as string,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, string | number>) => {
      const text = typeof fallback === 'string' ? fallback : key;
      if (!values) return text;
      return text.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values[name] ?? ''));
    },
  }),
}));

vi.mock('@/hooks/useAccountIntel', () => ({
  useAccountIntel: () => intel.current,
}));

import { ExtractStep } from './ExtractStep';

const DOC_ID = '11111111-1111-4111-8111-111111111111';
const FILE = 'Northwind-scope.pdf';
const CHECKING = 'Checking extraction status. The payload has not arrived.';
const FAILED = 'Extraction status did not load.';
const EMPTY = 'No extraction status yet.';
const QUEUED = 'Queued';

function unread(fetching: boolean) {
  intel.current = {
    data: undefined,
    isError: false,
    isLoading: fetching,
    status: 'pending',
  };
}

function renderStep(extracting: boolean) {
  return render(
    <MemoryRouter initialEntries={['/intake?account=acct-northwind']}>
      <ExtractStep
        selectedCount={1}
        extractingDocIds={extracting ? new Set([DOC_ID]) : new Set()}
        selectedDocNames={new Map([[DOC_ID, FILE]])}
        extractions={[]}
        onExtract={vi.fn()}
        isExtracting={false}
        onBack={vi.fn()}
      />
    </MemoryRouter>,
  );
}

describe('ExtractStep extraction status read', () => {
  afterEach(() => {
    cleanup();
    unread(false);
  });

  it('does not call a paused extraction read queued', () => {
    // WHY: a paused first read has isLoading false and no rows. Queued would
    // say the job is sitting in line. The status payload has not arrived.
    unread(false);
    renderStep(true);

    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expect(screen.queryByText(QUEUED)).toBeNull();
    expect(screen.queryByText(FILE)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it('does not call an in-flight extraction read queued', () => {
    // WHY: a slow read also has no rows. A loading shimmer is not this step.
    // Queued is still a status the payload has not sent.
    unread(true);
    renderStep(true);

    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expect(screen.queryByText(QUEUED)).toBeNull();
    expect(screen.queryByText(FILE)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it('does not call a failed extraction read queued', () => {
    // WHY: a failed read has no status. Queued would look like the job is waiting.
    intel.current = {
      data: undefined,
      isError: true,
      isLoading: false,
      status: 'error',
    };
    renderStep(true);

    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByText(QUEUED)).toBeNull();
    expect(screen.queryByText(FILE)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it('drops a stale running row when the status is error and isError is still false', () => {
    // WHY: error wins before a payload. A refetch failure must not keep Running.
    intel.current = {
      data: {
        extractions: [{ documentId: DOC_ID, status: 'running', error: null }],
      },
      isError: false,
      isLoading: false,
      status: 'error',
    };
    renderStep(true);

    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByText('Running')).toBeNull();
    expect(screen.queryByText(FILE)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(QUEUED)).toBeNull();
  });

  it('still says the status list is empty when the read arrived with no rows', () => {
    // WHY: an empty extraction list has arrived. That is not a pause, and it
    // is not a failed load. Queued would invent a status the list does not have.
    intel.current = {
      data: { extractions: [] },
      isError: false,
      isLoading: false,
      status: 'success',
    };
    renderStep(true);

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(QUEUED)).toBeNull();
    expect(screen.queryByText(FILE)).toBeNull();
  });

  it('treats a settled null payload as an empty status list', () => {
    intel.current = {
      data: null,
      isError: false,
      isLoading: false,
      status: 'success',
    };
    renderStep(true);

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(QUEUED)).toBeNull();
  });

  it('keeps a running status that arrived', () => {
    // WHY: a payload that arrived stays. The unread line must not replace Running.
    intel.current = {
      data: {
        extractions: [{ documentId: DOC_ID, status: 'running', error: null }],
      },
      isError: false,
      isLoading: false,
      status: 'success',
    };
    renderStep(true);

    expect(screen.getByText(FILE)).toBeTruthy();
    expect(screen.getByText('Running')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(QUEUED)).toBeNull();
  });

  it('still offers Run extraction before a job starts', () => {
    // WHY: the idle step is the action to start. An unread status list must
    // not replace that action, and it must not say the list is empty.
    unread(false);
    renderStep(false);

    expect(screen.getByRole('button', { name: 'Run extraction' })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(QUEUED)).toBeNull();
  });
});

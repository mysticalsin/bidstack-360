// A paused or in-flight compliance read has no rows yet. The matrix used the
// same "No compliance data yet" line as a fill that arrived empty. The matrix
// has not arrived, so that sentence is not a finding.
import type { ReactNode } from 'react';

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v6';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserRouter } from 'react-router-dom';

import type { ComplianceRow } from '@/hooks/rfp/useRfpCompliance';
import { useRfpPipelineStore } from '@/stores/rfpPipeline';

const apiMock = vi.hoisted(() => vi.fn());

const COPY = vi.hoisted(
  () =>
    ({
      'compliance.heading': 'Compliance Matrix',
      'compliance.emptyTitle': 'No compliance data yet',
      'compliance.emptyMessage':
        'Compliance rows will appear here after the compliance fill stage.',
      'states.error': 'Something went wrong. Please try again.',
    }) as Record<string, string>,
);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      fallback?: string | Record<string, unknown>,
      values?: Record<string, unknown>,
    ) => {
      const vars = typeof fallback === 'object' && fallback ? fallback : values;
      const template = typeof fallback === 'string' ? fallback : (COPY[key] ?? key);
      if (!vars) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(vars[name] ?? ''));
    },
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/lib/api', () => ({
  api: apiMock,
}));

import { ComplianceMatrix } from './ComplianceMatrix';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const MATRIX_PATH = `/api/v1/bid-workspaces/${WORKSPACE}/compliance`;
const EMPTY = 'No compliance data yet';
const EMPTY_DETAIL = 'Compliance rows will appear here after the compliance fill stage.';
const ZERO = '0 / 0 compliant · 0 pending';
const WAITING = 'Checking compliance. The matrix has not arrived.';
const ROW_TEXT = 'Keep the delivery window';

function matrixRow(): ComplianceRow {
  return {
    id: 'row-northwind',
    requirement: ROW_TEXT,
    response: null,
    status: 'pending',
    autoFilled: false,
    aiConfidenceBps: null,
    assessmentStatus: 'PENDING',
    section: null,
    mandatory: false,
  };
}

function renderMatrix() {
  useRfpPipelineStore.getState().setBidWorkspaceId(WORKSPACE);
  window.history.replaceState(null, '', '/rfp/ws/pipeline');
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'online' } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
          <NuqsAdapter>{children}</NuqsAdapter>
        </BrowserRouter>
      </QueryClientProvider>
    );
  }
  return render(<ComplianceMatrix />, { wrapper: Wrapper });
}

function hang(): Promise<never> {
  return new Promise(() => {});
}

function expectNoSettledMiss() {
  expect(screen.queryByRole('heading', { name: EMPTY })).toBeNull();
  expect(screen.queryByText(EMPTY_DETAIL)).toBeNull();
  expect(screen.queryByText(ZERO)).toBeNull();
  expect(screen.queryByText(ROW_TEXT)).toBeNull();
}

describe('ComplianceMatrix unread fill', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    onlineManager.setOnline(true);
    useRfpPipelineStore.getState().reset();
    window.history.replaceState(null, '', '/');
  });

  it('does not call a paused compliance read an empty matrix', async () => {
    // WHY: a paused first read has isLoading false and no rows. The matrix said
    // No compliance data yet, while the fill has not arrived.
    onlineManager.setOnline(false);
    apiMock.mockImplementation(hang);

    renderMatrix();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expectNoSettledMiss();
  });

  it('does not call an in-flight compliance read an empty matrix', async () => {
    // WHY: the skeleton alone still sat where a settled empty matrix sits.
    // A slow read is not an empty compliance matrix, and it does not count 0.
    onlineManager.setOnline(true);
    apiMock.mockImplementation(hang);

    renderMatrix();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expectNoSettledMiss();
  });

  it('does not call a failed compliance read an empty matrix', async () => {
    // WHY: a failed read is not evidence that nothing was filled. The error
    // stays, and the matrix does not say the fill is empty.
    apiMock.mockImplementation((path: string) => {
      if (path === MATRIX_PATH) return Promise.reject(new Error('network down'));
      if (path.startsWith('/api/v1/bid-facts')) return Promise.resolve({ items: [], total: 0 });
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderMatrix();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('network down');
    expect(screen.queryByText(WAITING)).toBeNull();
    expectNoSettledMiss();
  });

  it('still says a settled matrix found none', async () => {
    // WHY: a payload that arrived with no rows is a miss. That line stays, so a
    // real empty matrix is not dressed up as a slow network.
    apiMock.mockImplementation((path: string) => {
      if (path === MATRIX_PATH) {
        return Promise.resolve({ items: [], total: 0, compliantCount: 0, pendingCount: 0 });
      }
      if (path.startsWith('/api/v1/bid-facts')) return Promise.resolve({ items: [], total: 0 });
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderMatrix();

    expect(await screen.findByRole('heading', { name: EMPTY })).toBeTruthy();
    expect(screen.getByText(EMPTY_DETAIL)).toBeTruthy();
    expect(screen.getByText(ZERO)).toBeTruthy();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still shows a compliance row that has arrived', async () => {
    // WHY: a loaded row stays on the matrix. The unread line must not replace
    // a row the read already returned.
    apiMock.mockImplementation((path: string) => {
      if (path === MATRIX_PATH) {
        return Promise.resolve({
          items: [matrixRow()],
          total: 1,
          compliantCount: 0,
          pendingCount: 1,
        });
      }
      if (path.startsWith('/api/v1/bid-facts')) return Promise.resolve({ items: [], total: 0 });
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderMatrix();

    expect(await screen.findByText(ROW_TEXT)).toBeTruthy();
    expect(screen.getByText('0 / 1 compliant · 1 pending')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: EMPTY })).toBeNull();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(ZERO)).toBeNull();
  });
});

// A paused or in-flight edit has no report yet. The page used the same
// "Report not found" title and "It may have been deleted." line as a
// missing record. The report has not arrived, so it was not deleted.
// A failed read is not a missing record either.
import type { ReactNode } from 'react';

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api';
import type { Report } from '@/hooks/useAnalyticsReports';

const apiMock = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _key: string,
      fallback?: string | Record<string, unknown>,
      values?: Record<string, unknown>,
    ) => {
      const template = typeof fallback === 'string' ? fallback : _key;
      const vars = typeof fallback === 'object' && fallback ? fallback : values;
      if (!vars) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(vars[name] ?? ''));
    },
  }),
}));

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: apiMock,
}));

import { ReportBuilderPage } from './ReportBuilderPage';

const REPORT_ID = 'rep-1';
const DETAIL_PATH = `/api/reports/${REPORT_ID}`;
const NOT_FOUND = 'Report not found';
const DELETED = 'It may have been deleted.';
const WAITING = 'Checking this report. It has not arrived.';
const FAILED = 'Failed to load this report';
const REPORT_NAME = 'Pipeline coverage';

const REPORT: Report = {
  id: REPORT_ID,
  orgId: 'org-1',
  name: REPORT_NAME,
  ownerId: 'user-1',
  query: { entity: 'opportunity' },
  chartType: 'table',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function renderEdit() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'online' } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/reports/${REPORT_ID}/edit`]}>
          <Routes>
            <Route path="/reports/:id/edit" element={children} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(<ReportBuilderPage />, { wrapper: Wrapper });
}

function hang(): Promise<never> {
  return new Promise(() => {});
}

describe('ReportBuilderPage unread edit', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    onlineManager.setOnline(true);
  });

  it('does not call a paused report edit a deleted report', async () => {
    // WHY: a paused first read has isLoading false and no payload. The
    // page said Report not found and It may have been deleted, while
    // the report has not arrived.
    onlineManager.setOnline(false);
    apiMock.mockImplementation(hang);

    renderEdit();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: NOT_FOUND })).toBeNull();
    expect(screen.queryByText(DELETED)).toBeNull();
    expect(screen.queryByRole('heading', { name: FAILED })).toBeNull();
  });

  it('does not call an in-flight report edit a deleted report', async () => {
    // WHY: the pulse alone is not a missing record. A slow read has not
    // arrived, so it must not say the report was deleted.
    onlineManager.setOnline(true);
    apiMock.mockImplementation(hang);

    renderEdit();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: NOT_FOUND })).toBeNull();
    expect(screen.queryByText(DELETED)).toBeNull();
    expect(screen.queryByRole('heading', { name: FAILED })).toBeNull();
  });

  it('does not call a failed report edit a deleted report', async () => {
    // WHY: a network failure is not evidence the report is gone. The
    // failure stays, and the page does not say it was deleted.
    apiMock.mockImplementation((path: string) => {
      if (path === DETAIL_PATH) return Promise.reject(new Error('network down'));
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderEdit();

    expect(await screen.findByRole('heading', { name: FAILED })).toBeTruthy();
    expect(screen.getByText('network down')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: NOT_FOUND })).toBeNull();
    expect(screen.queryByText(DELETED)).toBeNull();
    expect(screen.queryByText(WAITING)).toBeNull();
  });

  it('still says a missing report was not found', async () => {
    // WHY: a settled 404 is a real miss. That title stays Report not
    // found, so a deleted report is not dressed up as a slow network.
    apiMock.mockImplementation((path: string) => {
      if (path === DETAIL_PATH) return Promise.reject(new ApiError('gone', 404, null));
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderEdit();

    expect(await screen.findByRole('heading', { name: NOT_FOUND })).toBeTruthy();
    expect(screen.getByText('gone')).toBeTruthy();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByRole('heading', { name: FAILED })).toBeNull();
  });

  it('still shows a report that has arrived', async () => {
    // WHY: a loaded report stays in the editor. The unread line must not
    // replace a name the read already returned.
    apiMock.mockImplementation((path: string) => {
      if (path === DETAIL_PATH) return Promise.resolve(REPORT);
      if (typeof path === 'string' && path.startsWith('/api/entities/')) return Promise.resolve([]);
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderEdit();

    expect(await screen.findByDisplayValue(REPORT_NAME)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Edit report' })).toBeTruthy();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByRole('heading', { name: NOT_FOUND })).toBeNull();
    expect(screen.queryByText(DELETED)).toBeNull();
  });
});

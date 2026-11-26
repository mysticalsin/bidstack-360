// A paused or in-flight reports list has no rows yet. The page used the
// same "No reports found" title and a 0 saved count as a settled empty
// catalog. The list has not arrived, so it is not an empty catalog.
import type { ReactNode } from 'react';

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

import { ReportsListPage } from './ReportsListPage';

const LIST_PATH = '/api/reports';
const NOT_FOUND = 'No reports found';
const ZERO = '0 saved reports';
const LIVE_ZERO = '0 reports';
const WAITING = 'Checking reports. The list has not arrived.';
const FAILED = 'Failed to load reports';
const REPORT_NAME = 'Pipeline coverage';

const REPORT: Report = {
  id: 'rep-1',
  orgId: 'org-1',
  name: REPORT_NAME,
  ownerId: 'user-1',
  query: { entity: 'opportunity' },
  chartType: 'table',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'online' } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(<ReportsListPage />, { wrapper: Wrapper });
}

function hang(): Promise<never> {
  return new Promise(() => {});
}

describe('ReportsListPage unread list', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    onlineManager.setOnline(true);
  });

  it('does not call a paused reports list an empty catalog', async () => {
    // WHY: a paused first read has isLoading false and no rows. The page
    // said No reports found and counted 0 saved reports, while the list
    // has not arrived.
    onlineManager.setOnline(false);
    apiMock.mockImplementation(hang);

    renderPage();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(screen.queryByText(ZERO)).toBeNull();
    expect(screen.queryByText(LIVE_ZERO)).toBeNull();
  });

  it('does not call an in-flight reports list an empty catalog', async () => {
    // WHY: the pulse alone still sat under a settled empty catalog. A slow
    // read is not an empty list, and it does not count 0 saved reports.
    onlineManager.setOnline(true);
    apiMock.mockImplementation(hang);

    renderPage();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(screen.queryByText(ZERO)).toBeNull();
    expect(screen.queryByText(LIVE_ZERO)).toBeNull();
  });

  it('does not call a failed reports list an empty catalog', async () => {
    // WHY: a failed read is not evidence the catalog is empty. The error
    // stays, and the page does not count 0 saved reports.
    apiMock.mockImplementation((path: string) => {
      if (path === LIST_PATH) return Promise.reject(new Error('network down'));
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPage();

    expect(await screen.findByRole('heading', { name: FAILED })).toBeTruthy();
    expect(screen.getByText('network down')).toBeTruthy();
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(screen.queryByText(ZERO)).toBeNull();
    expect(screen.queryByText(LIVE_ZERO)).toBeNull();
    expect(screen.queryByText(WAITING)).toBeNull();
  });

  it('still says a settled list found none', async () => {
    // WHY: a payload that arrived empty is a miss. That line stays
    // No reports found, and the count stays 0, so a real empty catalog
    // is not dressed up as a slow network.
    apiMock.mockImplementation((path: string) => {
      if (path === LIST_PATH) return Promise.resolve([]);
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPage();

    expect(await screen.findByText(NOT_FOUND)).toBeTruthy();
    expect(screen.getByText(ZERO)).toBeTruthy();
    expect(screen.getByText(LIVE_ZERO)).toBeTruthy();
    expect(screen.queryByText(WAITING)).toBeNull();
  });

  it('still shows a report that has arrived', async () => {
    // WHY: a loaded report stays on the list. The unread line must not
    // replace a name the read already returned.
    apiMock.mockImplementation((path: string) => {
      if (path === LIST_PATH) return Promise.resolve([REPORT]);
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPage();

    expect(await screen.findByText(REPORT_NAME)).toBeTruthy();
    expect(screen.getByText('1 saved reports')).toBeTruthy();
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(screen.queryByText(WAITING)).toBeNull();
  });
});

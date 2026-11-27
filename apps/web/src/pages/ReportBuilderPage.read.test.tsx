import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import type { Report } from '@/hooks/useAnalyticsReports';

import { ReportBuilderPage } from './ReportBuilderPage';

// An unread report has no payload. isLoading is false for a paused read and
// for an in-flight read that has not resolved. Neither is a missing report.
const hookMocks = vi.hoisted(() => ({
  report: {
    data: undefined as Report | null | undefined,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null as Error | null,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock('@/hooks/useAnalyticsReports', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useAnalyticsReports')>(
    '@/hooks/useAnalyticsReports',
  );
  return {
    ...actual,
    useAnalyticsReport: () => hookMocks.report,
  };
});

function loadedReport(overrides: Partial<Report> = {}): Report {
  return {
    id: 'rep-1',
    orgId: 'org-1',
    name: 'Northwind pipeline',
    description: '',
    ownerId: 'user-1',
    query: { entity: 'opportunity', limit: 0 },
    chartType: 'table',
    createdAt: '2026-06-16T12:00:00.000Z',
    updatedAt: '2026-06-16T12:00:00.000Z',
    ...overrides,
  };
}

function renderEditor() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/reports/rep-1/edit']}>
        <Routes>
          <Route path="/reports/:id/edit" element={<ReportBuilderPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe('report editor record read', () => {
  it('does not paint a paused read as a missing report', () => {
    hookMocks.report = {
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
    };
    renderEditor();
    expect(screen.getByText('Checking this report')).toBeTruthy();
    expect(screen.queryByText('Report not found')).toBeNull();
    expect(screen.queryByText('It may have been deleted.')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Edit report' })).toBeNull();
  });

  it('does not paint an in-flight read as a missing report', () => {
    hookMocks.report = {
      data: undefined,
      isLoading: false,
      isFetching: true,
      isError: false,
      error: null,
    };
    renderEditor();
    expect(screen.getByText('Checking this report')).toBeTruthy();
    expect(screen.queryByText('Report not found')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Edit report' })).toBeNull();
  });

  it('keeps a failed read on the error and drops a stale report', () => {
    hookMocks.report = {
      data: loadedReport({ name: 'Northwind pipeline' }),
      isLoading: false,
      isFetching: false,
      isError: true,
      error: new Error('boom'),
    };
    renderEditor();
    expect(screen.getByText('Could not load this report')).toBeTruthy();
    expect(screen.queryByDisplayValue('Northwind pipeline')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Edit report' })).toBeNull();
    expect(screen.queryByText('Report not found')).toBeNull();
  });

  it('keeps a failed read with no payload on the error', () => {
    hookMocks.report = {
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      error: new Error('boom'),
    };
    renderEditor();
    expect(screen.getByText('Could not load this report')).toBeTruthy();
    expect(screen.queryByText('Report not found')).toBeNull();
    expect(screen.queryByText('It may have been deleted.')).toBeNull();
  });

  it('keeps a settled null payload honestly missing', () => {
    hookMocks.report = {
      data: null,
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
    };
    renderEditor();
    expect(screen.getByText('Report not found')).toBeTruthy();
    expect(screen.getByText('It may have been deleted.')).toBeTruthy();
    expect(screen.queryByText('Checking this report')).toBeNull();
    expect(screen.queryByText('Could not load this report')).toBeNull();
  });

  it('keeps a loaded report, including a legitimate zero limit', () => {
    hookMocks.report = {
      data: loadedReport({ name: 'Northwind pipeline', query: { entity: 'opportunity', limit: 0 } }),
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
    };
    renderEditor();
    expect(screen.getByRole('heading', { name: 'Edit report' })).toBeTruthy();
    expect(screen.getByDisplayValue('Northwind pipeline')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
    expect(screen.queryByText('Report not found')).toBeNull();
    expect(screen.queryByText('Checking this report')).toBeNull();
  });

  it('keeps a loaded report when the name is blank', () => {
    hookMocks.report = {
      data: loadedReport({ name: '' }),
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
    };
    renderEditor();
    expect(screen.getByRole('heading', { name: 'Edit report' })).toBeTruthy();
    expect(screen.getByLabelText('Report name')).toHaveProperty('value', '');
    expect(screen.queryByText('Report not found')).toBeNull();
  });

  it('keeps a loaded report whose name is the digit zero', () => {
    hookMocks.report = {
      data: loadedReport({ name: '0' }),
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
    };
    renderEditor();
    expect(screen.getByDisplayValue('0')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Edit report' })).toBeTruthy();
    expect(screen.queryByText('Report not found')).toBeNull();
  });
});

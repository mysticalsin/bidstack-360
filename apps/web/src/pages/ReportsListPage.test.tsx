// Regression test for the reports:write permission gate — see MISTAKES-style
// audit finding: write actions (New/Run/Duplicate/Delete) were shown to every
// authenticated user even though the backend requires reports:write, so most
// non-Admin roles 403'd silently on click. This locks in that the affordances
// are hidden/disabled for read-only users and restored for writers.

import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Report } from '@/hooks/useAnalyticsReports';

import { ReportsListPage } from './ReportsListPage';

const hookMocks = vi.hoisted(() => ({
  reports: [] as Report[],
  canWrite: true,
  runMutate: vi.fn(),
  duplicateMutate: vi.fn(),
  deleteMutate: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values[key] ?? ''));
    },
  }),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: () => hookMocks.canWrite,
}));

vi.mock('@/hooks/useAnalyticsReports', () => ({
  useAnalyticsReportsList: () => ({
    data: hookMocks.reports,
    isLoading: false,
    error: null,
  }),
  useRunReport: () => ({ mutateAsync: hookMocks.runMutate }),
  useDuplicateReport: () => ({ mutate: hookMocks.duplicateMutate }),
  useDeleteReport: () => ({ mutate: hookMocks.deleteMutate }),
}));

function report(overrides: Partial<Report> = {}): Report {
  return {
    id: 'report-1',
    orgId: 'org-1',
    name: 'Won deals by month',
    ownerId: 'user-1',
    query: { entity: 'opportunity' },
    chartType: 'table',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ReportsListPage />
    </MemoryRouter>,
  );
}

describe('ReportsListPage — reports:write permission gate', () => {
  beforeEach(() => {
    hookMocks.reports = [report()];
    hookMocks.canWrite = true;
    hookMocks.runMutate.mockReset();
    hookMocks.duplicateMutate.mockReset();
    hookMocks.deleteMutate.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('hides "New report" and disables Run/Duplicate/Delete for a read-only user', () => {
    hookMocks.canWrite = false;
    renderPage();

    expect(screen.queryByRole('link', { name: /new report/i })).toBeNull();

    const runButton = screen.getByRole('button', { name: /run report/i }) as HTMLButtonElement;
    const duplicateButton = screen.getByRole('button', {
      name: /duplicate report/i,
    }) as HTMLButtonElement;
    const deleteButton = screen.getByRole('button', { name: /delete report/i }) as HTMLButtonElement;

    expect(runButton.disabled).toBe(true);
    expect(duplicateButton.disabled).toBe(true);
    expect(deleteButton.disabled).toBe(true);
    // Explanatory tooltip so a read-only user understands why the control is inert.
    expect(runButton.title).toMatch(/reports write access/i);
    expect(duplicateButton.title).toMatch(/reports write access/i);
    expect(deleteButton.title).toMatch(/reports write access/i);
  });

  it('shows "New report" and enables Run/Duplicate/Delete for a writer', () => {
    hookMocks.canWrite = true;
    renderPage();

    expect(screen.getByRole('link', { name: /new report/i })).toBeTruthy();

    const runButton = screen.getByRole('button', { name: /run report/i }) as HTMLButtonElement;
    const duplicateButton = screen.getByRole('button', {
      name: /duplicate report/i,
    }) as HTMLButtonElement;
    const deleteButton = screen.getByRole('button', { name: /delete report/i }) as HTMLButtonElement;

    expect(runButton.disabled).toBe(false);
    expect(duplicateButton.disabled).toBe(false);
    expect(deleteButton.disabled).toBe(false);
    expect(runButton.title).toBe('');
  });

  it('never lets a read-only user trigger the duplicate mutation', () => {
    hookMocks.canWrite = false;
    renderPage();

    const duplicateButton = screen.getByRole('button', { name: /duplicate report/i });
    duplicateButton.click();

    expect(hookMocks.duplicateMutate).not.toHaveBeenCalled();
  });
});

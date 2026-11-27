// A demo settings visit opens the audit trail before the page returns.
// A missing page has no rows. That is not an empty trail: the screen must
// not say there are no entries, count zero, or call the latest event none.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import type { AuditLogEntry } from '@bidstack/shared';

const hookMocks = vi.hoisted(() => ({
  useAuditLogs: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, vars?: Record<string, unknown>) => {
      const template = typeof fallback === 'string' ? fallback : key;
      const values =
        typeof fallback === 'object' && fallback !== null
          ? fallback
          : vars;
      if (!values) return template;
      return Object.entries(values).reduce(
        (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
        template,
      );
    },
  }),
}));

vi.mock('@/hooks/useAuditLogs', () => ({
  useAuditLogs: hookMocks.useAuditLogs,
}));

import { AuditLogSection } from './AuditLogSection';

const SAMPLE_ENTRY: AuditLogEntry = {
  id: '1',
  action: 'company.update',
  targetType: 'company',
  targetId: 'co-sample',
  userId: null,
  userName: 'Sample Admin',
  userEmail: 'sample.admin@example.com',
  diff: null,
  createdAt: '2026-11-25T12:00:00.000Z',
};

function queryResult(overrides: Record<string, unknown>) {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isError: false,
    dataUpdatedAt: 0,
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderSection() {
  return render(
    <MemoryRouter>
      <AuditLogSection />
    </MemoryRouter>,
  );
}

describe('Audit log when the page has not arrived', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not call a failed read an empty trail', () => {
    // WHY: a failed read has no rows. "No audit entries", "0 visible", and
    // "No events in range" tell a demo reader the trail was checked and is empty.
    hookMocks.useAuditLogs.mockReturnValue(
      queryResult({
        isError: true,
        error: new Error('audit log unavailable'),
      }),
    );

    renderSection();

    expect(screen.getByText('Failed to load audit entries')).toBeTruthy();
    expect(screen.getByText('Audit entries are not loaded')).toBeTruthy();
    expect(screen.queryByText('No audit entries')).toBeNull();
    expect(screen.queryByText('No audit entries match this range.')).toBeNull();
    expect(screen.queryByText('No events in range')).toBeNull();
    expect(screen.queryByText('No loaded events')).toBeNull();
    expect(screen.queryByText(/0 visible on page 1/)).toBeNull();
  });

  it('does not call a load in progress an empty trail', () => {
    // WHY: the first paint happens before the demo page returns. Zero events
    // and "No events in range" are a settled empty trail, not a pending read.
    hookMocks.useAuditLogs.mockReturnValue(
      queryResult({
        isLoading: true,
        isFetching: true,
      }),
    );

    renderSection();

    expect(screen.getByText('Refreshing evidence...')).toBeTruthy();
    expect(screen.queryByText('No audit entries')).toBeNull();
    expect(screen.queryByText('No events in range')).toBeNull();
    expect(screen.queryByText('No loaded events')).toBeNull();
    expect(screen.queryByText(/0 visible on page 1/)).toBeNull();
  });

  it('still says a loaded empty page has no audit entries', () => {
    // WHY: a page that arrived with no rows is empty. That sentence stays.
    hookMocks.useAuditLogs.mockReturnValue(
      queryResult({
        data: { items: [], nextCursor: null },
        dataUpdatedAt: Date.parse('2026-11-25T12:00:00.000Z'),
      }),
    );

    renderSection();

    expect(screen.getByText('No audit entries')).toBeTruthy();
    expect(screen.getByText(/0 visible on page 1/)).toBeTruthy();
    expect(screen.queryByText('Failed to load audit entries')).toBeNull();
    expect(screen.queryByText('Audit entries are not loaded')).toBeNull();
  });

  it('still shows a loaded audit entry', () => {
    // WHY: a page that arrived with a row keeps that row. The empty sentence
    // is only for a settled page with no rows.
    hookMocks.useAuditLogs.mockReturnValue(
      queryResult({
        data: { items: [SAMPLE_ENTRY], nextCursor: null },
        dataUpdatedAt: Date.parse('2026-11-25T12:00:00.000Z'),
      }),
    );

    renderSection();

    expect(screen.getAllByText('Sample Admin').length).toBeGreaterThan(0);
    expect(screen.queryByText('No audit entries')).toBeNull();
    expect(screen.queryByText('Failed to load audit entries')).toBeNull();
  });
});

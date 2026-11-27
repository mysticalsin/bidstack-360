// The settings audit section hands this strip an empty list both when the
// page has not arrived and when a loaded page has no rows. A missing page
// is not an empty trail: the strip must not say there are no events, name
// the top actor None, or score the evidence at zero.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuditLogEntry } from '@bidstack/shared';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      fallback?: string | Record<string, unknown>,
      vars?: Record<string, unknown>,
    ) => {
      const template = typeof fallback === 'string' ? fallback : key;
      const values = typeof fallback === 'object' && fallback !== null ? fallback : vars;
      if (!values) return template;
      return Object.entries(values).reduce(
        (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
        template,
      );
    },
  }),
}));

import { auditPayloadArrived, type AuditQuerySnapshot } from './audit-log-arrival';
import { AuditInsightStrip } from './AuditLogInsights';

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

const AUDIT_KEY = ['audit-logs', { limit: 200 }] as const;

function client() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderStrip(queryClient: QueryClient, rows: AuditLogEntry[]) {
  return render(
    <QueryClientProvider client={queryClient}>
      <AuditInsightStrip rows={rows} />
    </QueryClientProvider>,
  );
}

function expectNotScoredEmpty() {
  expect(screen.queryByText('No loaded events')).toBeNull();
  expect(screen.queryByText('None')).toBeNull();
  expect(screen.queryByText('0% attention events')).toBeNull();
  expect(screen.queryByText('0/100')).toBeNull();
  expect(screen.queryByText('0 attention events')).toBeNull();
  expect(screen.queryByText('0/0 events')).toBeNull();
  expect(screen.queryByText('0 destructive, 0 security/API')).toBeNull();
}

describe('Audit insight strip when the page has not arrived', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not call a failed read an empty trail', async () => {
    // WHY: a failed read has no rows. "No loaded events", "None", a jade
    // "0% attention events", and "0/100" tell a demo reader the trail was
    // scored and is empty.
    const queryClient = client();
    await queryClient
      .prefetchQuery({
        queryKey: AUDIT_KEY,
        queryFn: () => Promise.reject(new Error('audit log unavailable')),
      })
      .catch(() => undefined);

    renderStrip(queryClient, []);

    expect(screen.getByText('Audit entries are not loaded')).toBeTruthy();
    expectNotScoredEmpty();
  });

  it('does not call a load in progress an empty trail', () => {
    // WHY: the first paint happens before the demo page returns. Zero
    // attention and a 0/100 score are a settled empty trail, not a pending read.
    const queryClient = client();
    void queryClient.prefetchQuery({
      queryKey: AUDIT_KEY,
      queryFn: () => new Promise(() => {}),
    });

    renderStrip(queryClient, []);

    expect(screen.getByText('Audit entries are not loaded')).toBeTruthy();
    expectNotScoredEmpty();
  });

  it('still describes a loaded empty page as having no events', () => {
    // WHY: a page that arrived with no rows is empty. That sentence stays.
    const queryClient = client();
    queryClient.setQueryData(AUDIT_KEY, { items: [], nextCursor: null });

    renderStrip(queryClient, []);

    expect(screen.getAllByText('No loaded events').length).toBeGreaterThan(0);
    expect(screen.getAllByText('None').length).toBeGreaterThan(0);
    expect(screen.getByText('0% attention events')).toBeTruthy();
    expect(screen.queryByText('Audit entries are not loaded')).toBeNull();
  });

  it('still shows a loaded audit actor', () => {
    // WHY: a page that arrived with a row keeps that actor. The not-loaded
    // sentence is only for a page that has not arrived.
    const queryClient = client();
    queryClient.setQueryData(AUDIT_KEY, { items: [SAMPLE_ENTRY], nextCursor: null });

    renderStrip(queryClient, [SAMPLE_ENTRY]);

    expect(screen.getByText('Sample Admin')).toBeTruthy();
    expect(screen.queryByText('Audit entries are not loaded')).toBeNull();
    expect(screen.queryByText('No loaded events')).toBeNull();
  });
});

function snapshot(overrides: Partial<AuditQuerySnapshot>): AuditQuerySnapshot {
  return {
    data: undefined,
    dataUpdatedAt: 0,
    errorUpdatedAt: 0,
    fetchStatus: 'idle',
    ...overrides,
  };
}

describe('auditPayloadArrived', () => {
  it('is false when no audit query has been registered', () => {
    // WHY: an empty row list with no query is a page that has not been read.
    expect(auditPayloadArrived([])).toBe(false);
  });

  it('is false when the only query failed or is still fetching', () => {
    // WHY: failure and in-flight both have no page. Neither is a settled empty trail.
    expect(auditPayloadArrived([snapshot({ fetchStatus: 'idle', errorUpdatedAt: 10 })])).toBe(
      false,
    );
    expect(auditPayloadArrived([snapshot({ fetchStatus: 'fetching' })])).toBe(false);
  });

  it('is true for a settled page, including one with no rows', () => {
    // WHY: data that arrived as an empty page is empty. The score is allowed.
    expect(
      auditPayloadArrived([
        snapshot({ data: { items: [], nextCursor: null }, dataUpdatedAt: 20, fetchStatus: 'idle' }),
      ]),
    ).toBe(true);
  });

  it('is false while a newer page is in flight beside an older settled page', () => {
    // WHY: moving to the next page clears the visible rows before that page
    // arrives. The older page must not be scored as this view.
    expect(
      auditPayloadArrived([
        snapshot({ data: { items: [], nextCursor: '2' }, dataUpdatedAt: 20, fetchStatus: 'idle' }),
        snapshot({ fetchStatus: 'fetching', dataUpdatedAt: 0 }),
      ]),
    ).toBe(false);
  });

  it('is false when a newer read failed after a settled page', () => {
    // WHY: the latest attempt failed. The previous page is not the current read.
    expect(
      auditPayloadArrived([
        snapshot({ data: { items: [], nextCursor: null }, dataUpdatedAt: 20 }),
        snapshot({ errorUpdatedAt: 40, fetchStatus: 'idle' }),
      ]),
    ).toBe(false);
  });

  it('is true when a settled page is newer than an old failure', () => {
    // WHY: a later successful read replaces the failure, even if the page is empty.
    expect(
      auditPayloadArrived([
        snapshot({ errorUpdatedAt: 10, fetchStatus: 'idle' }),
        snapshot({ data: { items: [], nextCursor: null }, dataUpdatedAt: 30, fetchStatus: 'idle' }),
      ]),
    ).toBe(true);
  });
});

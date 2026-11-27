// A paused or in-flight webhook list has no rows yet. The hero counted
// zero events and said no errors were loaded. Invoice events still ride
// that list. The count has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IntegrationSummary } from './types';

const hookMocks = vi.hoisted(() => ({
  useWebhookEventsRead: vi.fn(),
}));

vi.mock('@/pages/integrations/useWebhookEventsRead', () => ({
  useWebhookEventsRead: hookMocks.useWebhookEventsRead,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | { count?: number }, options?: { count?: number }) => {
      if (typeof fallback !== 'string') return key;
      const count = options?.count;
      return count == null ? fallback : fallback.replace('{{count}}', String(count));
    },
  }),
}));

import { IntegrationHero } from './IntegrationHero';

const CHECKING = 'Checking events. The list has not arrived.';
const FAILED = 'Failed to load events';
const NO_ERRORS = 'No event errors loaded';
const INVOICE_PAID = {
  id: 'evt-1',
  receivedAt: '2026-11-01T00:00:00.000Z',
  source: 'billing.webhook',
  eventType: 'invoice.paid',
  status: 'processed',
  error: null,
};

const baseSummary: IntegrationSummary = {
  readyPaths: 4,
  pathTotal: 4,
  dustAgents: 2,
  webhookEvents: 0,
  attentionEvents: 0,
  activeMcpTools: 3,
  latestSyncLabel: 'Synced',
  postureLabel: 'Ready',
  postureTone: 'jade',
};

function renderHero(
  read: { data?: unknown; isError?: boolean; status?: string },
  summaryPatch?: Partial<IntegrationSummary>,
  eventsContinue = false,
) {
  hookMocks.useWebhookEventsRead.mockReturnValue({
    data: read.data,
    isError: read.isError ?? false,
    status: read.status ?? 'pending',
  });
  render(
    <IntegrationHero
      activeTab="overview"
      isLoading={false}
      summary={{ ...baseSummary, ...summaryPatch }}
      eventsContinue={eventsContinue}
      onCreateApiKey={() => undefined}
      onAddWebhook={() => undefined}
    />,
  );
}

describe('IntegrationHero webhook event figure', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused event list as zero or paid', () => {
    // WHY: a paused first read has isLoading false and no page. Zero events
    // and no errors loaded say the list arrived. This one has not. An
    // invoice.paid row must not be invented as paid.
    renderHero({ data: undefined, isError: false, status: 'pending' });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(NO_ERRORS)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText('paid')).toBeNull();
    expect(screen.queryByText('invoice.paid')).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('does not treat an in-flight event list as zero or paid', () => {
    // WHY: a slow read also has no page, and isLoading can stay false.
    // Zero and no errors loaded must not stand in for a read that is still running.
    renderHero({ data: undefined, isError: false, status: 'pending' });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(NO_ERRORS)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText('paid')).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('keeps a failed event list on the error', () => {
    // WHY: a failed read is not an unread pause. Checking must not stand in
    // for the error, and zero events must not open.
    renderHero({ data: undefined, isError: true, status: 'error' });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(NO_ERRORS)).toBeNull();
    expect(screen.queryByText('paid')).toBeNull();
    expect(screen.queryByLabelText('0')).toBeNull();
  });

  it('lets a failed status win over a stale invoice.paid count', () => {
    // WHY: error wins before a payload. A refetch failure must not keep a
    // count of one, and it must not call that invoice.paid row paid or quiet.
    renderHero(
      {
        data: { items: [INVOICE_PAID], pageContinues: false },
        isError: false,
        status: 'error',
      },
      { webhookEvents: 1 },
    );

    expect(screen.queryByLabelText('1')).toBeNull();
    expect(screen.queryByText('invoice.paid')).toBeNull();
    expect(screen.queryByText('paid')).toBeNull();
    expect(screen.queryByText(NO_ERRORS)).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('stays on zero when a settled payload is null', () => {
    // WHY: null has arrived. Undefined data is unread. A null payload is not
    // a failed load, and it is not still checking.
    renderHero({ data: null, isError: false, status: 'success' });

    expect(screen.getByText(NO_ERRORS)).toBeTruthy();
    expect(screen.getByLabelText('0')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText('paid')).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('stays on zero when a settled list is empty', () => {
    // WHY: an empty list has arrived. Unread must not replace that settled
    // miss, and the miss must not say the load failed.
    renderHero({
      data: { items: [], pageContinues: false },
      isError: false,
      status: 'success',
    });

    expect(screen.getByText(NO_ERRORS)).toBeTruthy();
    expect(screen.getByLabelText('0')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('counts a loaded invoice.paid event without calling the book paid', () => {
    // WHY: a loaded invoice.paid row is one event. The figure stays the count.
    // Unread must not drop it, and the hero must not invent a paid invoice.
    renderHero(
      {
        data: { items: [INVOICE_PAID], pageContinues: false },
        isError: false,
        status: 'success',
      },
      { webhookEvents: 1 },
    );

    expect(screen.getByLabelText('1')).toBeTruthy();
    expect(screen.getByText(NO_ERRORS)).toBeTruthy();
    expect(screen.queryByText('invoice.paid')).toBeNull();
    expect(screen.queryByText('paid')).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ useWebhookDeliveries: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback: string, vars?: Record<string, unknown>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_, n: string) => String(vars?.[n] ?? '')),
  }),
}));
vi.mock('@/hooks/useWebhookSubscriptions', () => ({
  useWebhookDeliveries: m.useWebhookDeliveries,
}));

import { DeliveryHistoryPanel } from './DeliveryHistoryPanel';

const DENIED = {
  id: 'd-denied',
  event: 'ping',
  statusCode: null,
  success: false,
  durationMs: 0,
  attempt: 1,
  errorMessage: 'SERUM connector policy denied webhook_delivery webhook.testPing: demo',
  createdAt: '2026-11-07T12:00:00.000Z',
};

const HTTP = {
  id: 'd-http',
  event: 'lead.created',
  statusCode: 404,
  success: false,
  durationMs: 80,
  attempt: 1,
  errorMessage: null,
  createdAt: '2026-11-07T12:01:00.000Z',
};

function loaded(rows: Array<typeof DENIED | typeof HTTP>) {
  m.useWebhookDeliveries.mockReturnValue({
    isLoading: false,
    isError: false,
    data: { data: rows, hasMore: false },
  });
}

beforeEach(() => {
  loaded([DENIED]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DeliveryHistoryPanel', () => {
  it('does not call a delivery with no HTTP status a timeout', () => {
    // WHY: Settings, Webhooks, History is where a demo admin reads one attempt.
    // A blocked URL, a policy denial, and a dropped connection all store no HTTP
    // status. The status cell printed "timeout", which points at the receiver
    // budget. The message log already says "No response" for the same fact.
    render(<DeliveryHistoryPanel subscriptionId="sub-1" id="deliveries-sub-1" />);

    expect(screen.queryByText('timeout')).toBeNull();
    expect(screen.getByText('No response')).toBeTruthy();
    expect(screen.getByText('ping')).toBeTruthy();
  });

  it('keeps an HTTP status code on the row', () => {
    // WHY: a receiver that answered still shows that code. Only a missing
    // status stops reading as a timeout.
    loaded([HTTP]);
    render(<DeliveryHistoryPanel subscriptionId="sub-1" id="deliveries-sub-1" />);

    expect(screen.getByText('404')).toBeTruthy();
    expect(screen.queryByText('No response')).toBeNull();
    expect(screen.queryByText('timeout')).toBeNull();
  });
});

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const subscriptionMocks = vi.hoisted(() => ({
  useWebhookSubscriptions: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, string | number>) => {
      const template = fallback ?? key;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        String(values?.[name] ?? ''),
      );
    },
  }),
}));

vi.mock('@/lib/auth', () => ({
  useIsAdmin: () => true,
}));

vi.mock('@/hooks/useWebhookSubscriptions', () => ({
  useWebhookSubscriptions: subscriptionMocks.useWebhookSubscriptions,
  useCreateWebhookSubscription: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateWebhookSubscription: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteWebhookSubscription: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTestWebhookPing: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/components/webhooks/CreateWebhookDialog', () => ({ CreateWebhookDialog: () => null }));
vi.mock('@/components/webhooks/DeliveriesPanel', () => ({
  DeliveriesPanel: () => null,
  WebhookFilterBar: () => null,
}));
vi.mock('@/components/webhooks/DeliveryHistoryPanel', () => ({ DeliveryHistoryPanel: () => null }));
vi.mock('@/components/webhooks/MessageLog', () => ({ MessageLog: () => null }));
vi.mock('@/components/webhooks/RetryScheduleEditor', () => ({ RetryScheduleEditor: () => null }));
vi.mock('@/components/webhooks/SignatureGuide', () => ({ SignatureGuide: () => null }));

import { WebhooksSection } from './WebhooksSection';

function settle(overrides: Record<string, unknown> = {}) {
  subscriptionMocks.useWebhookSubscriptions.mockReturnValue({
    data: undefined,
    isError: false,
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
    ...overrides,
  });
}

describe('Webhooks settings health', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not call a failed webhook read All clear', () => {
    // WHY: a demo admin opens Settings, Webhooks to see whether deliveries
    // are healthy. A failed read has no list. The hero used to count that
    // missing list as zero and say All clear, None, and no activity.
    settle({ isError: true, error: new Error('unavailable') });

    render(<WebhooksSection />);

    expect(screen.getByText('Could not load webhook subscriptions. Check your admin permissions or refresh.')).toBeTruthy();
    expect(screen.queryByText('All clear')).toBeNull();
    expect(screen.queryByText('None')).toBeNull();
    expect(screen.queryByText('No delivery activity recorded yet.')).toBeNull();
    expect(screen.getAllByText('Not loaded').length).toBeGreaterThan(0);
    expect(screen.getByText('Delivery activity is not loaded.')).toBeTruthy();
  });

  it('does not call a webhook read that is still loading All clear', () => {
    // WHY: the same hero paints before the list arrives. Zeros during the
    // load are the empty book the admin has not earned yet.
    settle({ isLoading: true });

    render(<WebhooksSection />);

    expect(screen.queryByText('All clear')).toBeNull();
    expect(screen.queryByText('No delivery activity recorded yet.')).toBeNull();
    expect(screen.getByText('Delivery activity is not loaded.')).toBeTruthy();
  });

  it('says All clear when the finished list is empty', () => {
    // WHY: a settled empty subscription list is a real empty book. All clear
    // and no activity are honest then. The guard is only for a missing list.
    settle({ data: { items: [], pageContinues: false } });

    render(<WebhooksSection />);

    expect(screen.getByText('All clear')).toBeTruthy();
    expect(screen.getByText('No delivery activity recorded yet.')).toBeTruthy();
    expect(screen.queryByText('Delivery activity is not loaded.')).toBeNull();
  });
});

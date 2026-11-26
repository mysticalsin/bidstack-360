// WHY: Settings, Webhooks is where a demo admin reads outbound subscriptions.
// A failed read has no rows. The badge still said All clear, the activity line
// still said no deliveries had been recorded, and every count said None.
// A load in progress used that same empty book. An empty book and a book that
// never arrived are different.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  useWebhookSubscriptions: vi.fn(),
  useCreateWebhookSubscription: vi.fn(),
  useUpdateWebhookSubscription: vi.fn(),
  useDeleteWebhookSubscription: vi.fn(),
  useTestWebhookPing: vi.fn(),
  useRotateWebhookSecret: vi.fn(),
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
  useWebhookSubscriptions: hookMocks.useWebhookSubscriptions,
  useCreateWebhookSubscription: hookMocks.useCreateWebhookSubscription,
  useUpdateWebhookSubscription: hookMocks.useUpdateWebhookSubscription,
  useDeleteWebhookSubscription: hookMocks.useDeleteWebhookSubscription,
  useTestWebhookPing: hookMocks.useTestWebhookPing,
}));

vi.mock('@/hooks/useWebhookDeliveries', () => ({
  useRotateWebhookSecret: hookMocks.useRotateWebhookSecret,
}));

import { WebhooksSection } from './WebhooksSection';

const DUST = {
  id: 'sub-dust',
  url: 'https://dust.example/hooks/demo',
  events: ['crm.company.updated'],
  active: true,
  failureCount: 2,
  lastDeliveryAt: null,
  lastFailureAt: '2026-11-25T12:00:00.000Z',
  createdAt: '2026-11-01T00:00:00.000Z',
};

function idleMutations() {
  const idle = { mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false };
  hookMocks.useCreateWebhookSubscription.mockReturnValue(idle);
  hookMocks.useUpdateWebhookSubscription.mockReturnValue(idle);
  hookMocks.useDeleteWebhookSubscription.mockReturnValue(idle);
  hookMocks.useTestWebhookPing.mockReturnValue(idle);
  hookMocks.useRotateWebhookSecret.mockReturnValue(idle);
}

function subscriptions(state: {
  data?: { items: Array<typeof DUST>; pageContinues: boolean };
  isLoading?: boolean;
  isError?: boolean;
}) {
  hookMocks.useWebhookSubscriptions.mockReturnValue({
    data: state.data,
    isLoading: state.isLoading ?? false,
    isError: state.isError ?? false,
    isFetching: state.isLoading ?? false,
    refetch: vi.fn(),
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('WebhooksSection failed read', () => {
  it('does not call a failed subscription read an empty all-clear book', () => {
    // WHY: a failed read has no rows. All clear, no recorded activity, and
    // None counts describe a book the screen never showed.
    idleMutations();
    subscriptions({ isError: true });

    render(<WebhooksSection />);

    expect(screen.queryByText('All clear')).toBeNull();
    expect(screen.queryByText('No delivery activity recorded yet.')).toBeNull();
    expect(screen.queryByText('None')).toBeNull();
    expect(screen.queryByText('No subscriptions yet')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add subscription' })).toBeNull();
    expect(screen.getByText('not loaded')).toBeTruthy();
    expect(screen.getByText('Failed to load webhooks')).toBeTruthy();
  });

  it('does not call a load in progress an empty all-clear book', () => {
    // WHY: the same header paints before the page arrives. All clear during
    // the load is the empty book the reader has not earned yet.
    idleMutations();
    subscriptions({ isLoading: true });

    render(<WebhooksSection />);

    expect(screen.queryByText('All clear')).toBeNull();
    expect(screen.queryByText('No delivery activity recorded yet.')).toBeNull();
    expect(screen.queryByText('None')).toBeNull();
    expect(screen.queryByText('No subscriptions yet')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add subscription' })).toBeNull();
    expect(screen.getByText('checking')).toBeTruthy();
    expect(screen.queryByText('Failed to load webhooks')).toBeNull();
  });

  it('keeps a loaded empty book all clear', () => {
    // WHY: a settled read with no subscriptions is an empty book. That copy stays.
    idleMutations();
    subscriptions({ data: { items: [], pageContinues: false } });

    render(<WebhooksSection />);

    expect(screen.getByText('All clear')).toBeTruthy();
    expect(screen.getByText('No delivery activity recorded yet.')).toBeTruthy();
    expect(screen.getByText('No subscriptions yet')).toBeTruthy();
    expect(screen.getAllByText('None').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Add subscription' }).length).toBeGreaterThan(0);
    expect(screen.queryByText('not loaded')).toBeNull();
    expect(screen.queryByText('checking')).toBeNull();
  });

  it('keeps a loaded Dust subscription that is failing', () => {
    // WHY: a demo endpoint that arrived still names the URL, and a failure
    // count still asks for attention.
    idleMutations();
    subscriptions({ data: { items: [DUST], pageContinues: false } });

    render(<WebhooksSection />);

    expect(screen.getByText('https://dust.example/hooks/demo')).toBeTruthy();
    expect(screen.getByText('crm.company.updated')).toBeTruthy();
    expect(screen.getByText('1 need attention')).toBeTruthy();
    expect(screen.getByText('2 failures')).toBeTruthy();
    expect(screen.queryByText('All clear')).toBeNull();
    expect(screen.queryByText('No subscriptions yet')).toBeNull();
    expect(screen.queryByText('not loaded')).toBeNull();
  });
});

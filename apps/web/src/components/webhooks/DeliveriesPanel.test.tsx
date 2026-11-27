import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ useWebhookDeliveryStats: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback: string, vars?: Record<string, unknown>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_, n: string) => String(vars?.[n] ?? '')),
  }),
}));
vi.mock('@/hooks/useWebhookDeliveries', () => ({
  useWebhookDeliveryStats: m.useWebhookDeliveryStats,
}));

import { DeliveriesPanel } from './DeliveriesPanel';

const SUBS = [
  { id: 's1', url: 'https://a.example.com/hook' },
  { id: 's2', url: 'https://b.example.com/hook' },
];

beforeEach(() => {
  m.useWebhookDeliveryStats.mockReturnValue({
    isLoading: false,
    isError: false,
    data: {
      messages: { total: 7, succeeded: 6, failed: 1, pending: 0 },
      successRate: 6 / 7,
      heatmap: [
        { subscriptionId: 's1', hour: 14, attempts: 3, failures: 1 },
        { subscriptionId: 's2', hour: 9, attempts: 5, failures: 0 },
      ],
      latencyMs: [100, 120, 900],
    },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DeliveriesPanel', () => {
  it('shows the success rate as a meter with its value as text', () => {
    render(<DeliveriesPanel subscriptions={SUBS} filters={{}} onFiltersChange={vi.fn()} />);
    const meter = screen.getByRole('meter', { name: 'Success rate' });
    expect(meter.getAttribute('aria-valuetext')).toContain('85.7%');
    expect(screen.getAllByText('85.7%').length).toBeGreaterThan(0);
  });

  it('draws one cell per endpoint and hour, each with an accessible name', () => {
    render(<DeliveriesPanel subscriptions={SUBS} filters={{}} onFiltersChange={vi.fn()} />);
    expect(
      screen.getByRole('img', { name: 'a.example.com, 14:00 UTC: 3 attempts, 1 failed' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('img', { name: 'b.example.com, 09:00 UTC: 5 attempts, 0 failed' }),
    ).toBeTruthy();
    expect(screen.getAllByRole('img', { name: /UTC: 0 attempts/ })).toHaveLength(46);
  });

  it('offers the heatmap as a table', () => {
    render(<DeliveriesPanel subscriptions={SUBS} filters={{}} onFiltersChange={vi.fn()} />);
    const toggle = screen.getByRole('button', { name: 'View as table' });
    expect(toggle.className).toContain('pointer-coarse:min-h-11');
    expect(toggle.className).toContain('pointer-coarse:min-w-11');
    fireEvent.click(toggle);
    const table = screen.getByRole('table', { name: 'Attempts by endpoint and hour' });
    expect(table.textContent).toContain('a.example.com');
    expect(table.textContent).toContain('14:00');
  });

  it('does not call a window of only retries an empty delivery book', () => {
    // WHY: a demo admin opens Deliveries to see whether outbound webhooks are
    // healthy. Retries in flight have no settled success rate. The panel used
    // to say there were no delivered or failed messages, which reads as all clear.
    m.useWebhookDeliveryStats.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        messages: { total: 3, succeeded: 0, failed: 0, pending: 3 },
        successRate: null,
        heatmap: [],
        latencyMs: [],
      },
    });

    render(<DeliveriesPanel subscriptions={SUBS} filters={{}} onFiltersChange={vi.fn()} />);

    expect(screen.queryByText('No delivered or failed messages in this window yet.')).toBeNull();
    expect(
      screen.getByText('Retries still in flight: 3. This window is not clear.'),
    ).toBeTruthy();
    expect(screen.queryByRole('meter', { name: 'Success rate' })).toBeNull();
  });

  it('keeps open retries visible beside a settled success rate', () => {
    // WHY: one settled success does not make the window clear while retries
    // are still open. The settled rate can stay. The caption has to keep the
    // retries, or the gauge reads as a stale all clear.
    m.useWebhookDeliveryStats.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        messages: { total: 3, succeeded: 1, failed: 0, pending: 2 },
        successRate: 1,
        heatmap: [],
        latencyMs: [80],
      },
    });

    render(<DeliveriesPanel subscriptions={SUBS} filters={{}} onFiltersChange={vi.fn()} />);

    expect(screen.getByRole('meter', { name: 'Success rate' })).toBeTruthy();
    expect(
      screen.getByText('0 of 1 settled failed. 2 still retrying.'),
    ).toBeTruthy();
    expect(screen.queryByText('0 of 1 failed')).toBeNull();
  });

  it('keeps a settled empty window as no delivery activity', () => {
    // WHY: a finished window with no successes, failures, or retries is a real
    // empty book. That sentence stays. Only open retries must refuse it.
    m.useWebhookDeliveryStats.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        messages: { total: 0, succeeded: 0, failed: 0, pending: 0 },
        successRate: null,
        heatmap: [],
        latencyMs: [],
      },
    });

    render(<DeliveriesPanel subscriptions={SUBS} filters={{}} onFiltersChange={vi.fn()} />);

    expect(screen.getByText('No delivered or failed messages in this window yet.')).toBeTruthy();
    expect(screen.queryByText(/not clear/)).toBeNull();
  });

  it('passes endpoint, event, status and window filters up', () => {
    const onFiltersChange = vi.fn();
    render(<DeliveriesPanel subscriptions={SUBS} filters={{}} onFiltersChange={onFiltersChange} />);
    fireEvent.change(screen.getByLabelText('Endpoint'), { target: { value: 's2' } });
    expect(onFiltersChange).toHaveBeenLastCalledWith({ subscriptionId: 's2' });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'failed' } });
    expect(onFiltersChange).toHaveBeenLastCalledWith({ status: 'failed' });
    fireEvent.change(screen.getByLabelText('Event'), { target: { value: 'lead.created' } });
    expect(onFiltersChange).toHaveBeenLastCalledWith({ event: 'lead.created' });
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '7d' } });
    expect(onFiltersChange).toHaveBeenLastCalledWith({ window: '7d' });
  });
});

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
    fireEvent.click(screen.getByRole('button', { name: 'View as table' }));
    const table = screen.getByRole('table', { name: 'Attempts by endpoint and hour' });
    expect(table.textContent).toContain('a.example.com');
    expect(table.textContent).toContain('14:00');
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

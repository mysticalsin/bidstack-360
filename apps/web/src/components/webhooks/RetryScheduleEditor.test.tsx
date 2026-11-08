import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  useWebhookRetryPolicy: vi.fn(),
  useSaveWebhookRetryPolicy: vi.fn(),
  useResetWebhookRetryPolicy: vi.fn(),
  useWebhookDeliveryStats: vi.fn(),
  save: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback: string, vars?: Record<string, unknown>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_, n: string) => String(vars?.[n] ?? '')),
  }),
}));
vi.mock('@/hooks/useWebhookDeliveries', () => ({
  useWebhookRetryPolicy: m.useWebhookRetryPolicy,
  useSaveWebhookRetryPolicy: m.useSaveWebhookRetryPolicy,
  useResetWebhookRetryPolicy: m.useResetWebhookRetryPolicy,
  useWebhookDeliveryStats: m.useWebhookDeliveryStats,
}));
vi.mock('@/components/ui/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { RetryScheduleEditor } from './RetryScheduleEditor';

const SUBS = [{ id: 's1', url: 'https://a.example.com/hook' }];

beforeEach(() => {
  m.useWebhookRetryPolicy.mockReturnValue({
    data: {
      maxAttempts: 5,
      backoffStrategy: 'exponential',
      backoffBaseSeconds: 30,
      timeoutMs: 10000,
    },
    isLoading: false,
    isError: false,
  });
  m.useSaveWebhookRetryPolicy.mockReturnValue({ mutateAsync: m.save, isPending: false });
  m.useResetWebhookRetryPolicy.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  m.useWebhookDeliveryStats.mockReturnValue({
    data: {
      messages: { total: 2, succeeded: 2, failed: 0, pending: 0 },
      successRate: 1,
      heatmap: [],
      latencyMs: [120, 340],
    },
    isLoading: false,
    isError: false,
  });
  m.save.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('RetryScheduleEditor', () => {
  it('previews the backoff curve from the saved policy', () => {
    render(<RetryScheduleEditor subscriptions={SUBS} />);
    const list = screen.getByRole('list', { name: 'Retry schedule' });
    expect(list.textContent).toContain('Attempt 1');
    expect(list.textContent).toContain('now');
    expect(list.textContent).toContain('+30s');
    expect(list.textContent).toContain('+1m');
    expect(list.textContent).toContain('+4m');
  });

  it('redraws the curve when the strategy changes', () => {
    render(<RetryScheduleEditor subscriptions={SUBS} />);
    fireEvent.change(screen.getByLabelText('Backoff'), { target: { value: 'fixed' } });
    const list = screen.getByRole('list', { name: 'Retry schedule' });
    expect(list.textContent?.match(/\+30s/g)).toHaveLength(4);
  });

  it('blocks out-of-range values before they reach the API', () => {
    render(<RetryScheduleEditor subscriptions={SUBS} />);
    fireEvent.change(screen.getByLabelText('Max attempts'), { target: { value: '11' } });
    expect(screen.getByText('Use 1 to 10 attempts.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('saves the edited policy for the selected endpoint', async () => {
    render(<RetryScheduleEditor subscriptions={SUBS} />);
    fireEvent.change(screen.getByLabelText('Max attempts'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Timeout (ms)'), { target: { value: '5000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(m.save).toHaveBeenCalledWith({
        maxAttempts: 3,
        backoffStrategy: 'exponential',
        backoffBaseSeconds: 30,
        timeoutMs: 5000,
      }),
    );
    expect(m.useSaveWebhookRetryPolicy).toHaveBeenCalledWith('s1');
  });

  it('shows the response-time distribution for the endpoint', () => {
    render(<RetryScheduleEditor subscriptions={SUBS} />);
    expect(screen.getByRole('group', { name: /Response time/ })).toBeTruthy();
  });
});

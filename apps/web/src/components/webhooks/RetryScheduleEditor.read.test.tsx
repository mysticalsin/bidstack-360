// A paused or in-flight retry read has no schedule yet. The editor filled the
// default curve, which looks like a stored policy. That read has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, vars?: Record<string, unknown>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(vars?.[name] ?? '')),
  }),
}));

const hooks = vi.hoisted(() => ({
  useWebhookRetryPolicy: vi.fn(),
  useSaveWebhookRetryPolicy: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useResetWebhookRetryPolicy: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useWebhookDeliveryStats: vi.fn(),
}));

vi.mock('@/hooks/useWebhookDeliveries', () => hooks);
vi.mock('@/components/ui/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { RetryScheduleEditor } from './RetryScheduleEditor';

const ENDPOINT = [{ id: 'sub-demo', url: 'https://hooks.example.com/demo' }];

const STORED = {
  maxAttempts: 4,
  backoffStrategy: 'fixed' as const,
  backoffBaseSeconds: 60,
  timeoutMs: 8000,
};

const CHECKING = 'Checking the retry schedule. The schedule has not arrived.';
const FAILED = 'Could not load the retry schedule.';
const EMPTY = 'No retry schedule is stored for this endpoint.';
const CHECKING_TIMES = 'Checking response times. The attempts have not arrived.';
const FAILED_TIMES = 'Could not load response times.';
const EMPTY_TIMES = 'No attempts in the last 7 days.';

function policyQuery(query: {
  data?: typeof STORED | null;
  isLoading: boolean;
  isError: boolean;
  status?: string;
}) {
  hooks.useWebhookRetryPolicy.mockReturnValue(query);
}

function statsQuery(query: {
  data?: { latencyMs: number[] } | null;
  isLoading: boolean;
  isError: boolean;
  status?: string;
}) {
  hooks.useWebhookDeliveryStats.mockReturnValue(query);
}

function renderEditor(subscriptions = ENDPOINT) {
  return render(<RetryScheduleEditor subscriptions={subscriptions} />);
}

describe('RetryScheduleEditor read', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not treat a paused schedule read as the default policy', () => {
    // WHY: a paused first read has isLoading false and no policy. Filling
    // the product default looks like a stored schedule. The schedule has
    // not arrived.
    policyQuery({ data: undefined, isLoading: false, isError: false, status: 'pending' });
    statsQuery({ data: { latencyMs: [120] }, isLoading: false, isError: false, status: 'success' });

    renderEditor();

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByLabelText('Max attempts')).toBeNull();
    expect(screen.queryByRole('list', { name: 'Retry schedule' })).toBeNull();
    expect(screen.queryByText('+30s')).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('does not treat an in-flight schedule read as the default policy', () => {
    // WHY: a slow read also has no policy. The default curve is not a
    // settled schedule, and it is not a failed load.
    policyQuery({ data: undefined, isLoading: true, isError: false, status: 'pending' });
    statsQuery({ data: { latencyMs: [120] }, isLoading: false, isError: false, status: 'success' });

    renderEditor();

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByLabelText('Max attempts')).toBeNull();
    expect(screen.queryByText('+30s')).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('keeps a failed schedule read on the error', () => {
    // WHY: a failed read is not evidence that the endpoint uses the default
    // curve. The error stays, and the default numbers do not stand in for
    // the read.
    policyQuery({ data: undefined, isLoading: false, isError: true, status: 'error' });
    statsQuery({ data: { latencyMs: [] }, isLoading: false, isError: false, status: 'success' });

    renderEditor();

    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByLabelText('Max attempts')).toBeNull();
    expect(screen.queryByText('+30s')).toBeNull();
  });

  it('lets a failed read win over a stale schedule', () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // showing 8 attempts from a policy that is no longer the read.
    policyQuery({
      data: { ...STORED, maxAttempts: 8 },
      isLoading: false,
      isError: true,
      status: 'error',
    });
    statsQuery({ data: { latencyMs: [] }, isLoading: false, isError: false, status: 'success' });

    renderEditor();

    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByDisplayValue('8')).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByLabelText('Max attempts')).toBeNull();
  });

  it('stays empty when a settled read has no schedule', () => {
    // WHY: a read that arrived without a policy stays empty. A missing
    // payload must not be dressed up as the product default.
    policyQuery({ data: null, isLoading: false, isError: false, status: 'success' });
    statsQuery({ data: { latencyMs: [] }, isLoading: false, isError: false, status: 'success' });

    renderEditor();

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByLabelText('Max attempts')).toBeNull();
    expect(screen.queryByText('+30s')).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a loaded schedule', () => {
    // WHY: a loaded policy stays. The unread line must not replace a
    // schedule the read already returned.
    policyQuery({ data: STORED, isLoading: false, isError: false, status: 'success' });
    statsQuery({ data: { latencyMs: [120] }, isLoading: false, isError: false, status: 'success' });

    renderEditor();

    expect((screen.getByLabelText('Max attempts') as HTMLInputElement).value).toBe('4');
    expect((screen.getByLabelText('Base delay (s)') as HTMLInputElement).value).toBe('60');
    expect(screen.getByRole('list', { name: 'Retry schedule' }).textContent).toContain('+1m');
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it('still shows a loaded schedule that matches the product default', () => {
    // WHY: five attempts is a loaded policy when the read returned it.
    // Unread must not look like that default, and a real default must not
    // look unread.
    policyQuery({
      data: {
        maxAttempts: 5,
        backoffStrategy: 'exponential',
        backoffBaseSeconds: 30,
        timeoutMs: 10000,
      },
      isLoading: false,
      isError: false,
      status: 'success',
    });
    statsQuery({ data: { latencyMs: [] }, isLoading: false, isError: false, status: 'success' });

    renderEditor();

    expect((screen.getByLabelText('Max attempts') as HTMLInputElement).value).toBe('5');
    expect(screen.getByRole('list', { name: 'Retry schedule' }).textContent).toContain('+30s');
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it('does not treat a paused response-time read as an empty week', () => {
    // WHY: a paused stats read has isLoading false and no attempts. "No
    // attempts in the last 7 days" is a settled empty week, not this read.
    policyQuery({ data: STORED, isLoading: false, isError: false, status: 'success' });
    statsQuery({ data: undefined, isLoading: false, isError: false, status: 'pending' });

    renderEditor();

    expect(screen.getByText(CHECKING_TIMES)).toBeTruthy();
    expect(screen.queryByText(EMPTY_TIMES)).toBeNull();
    expect(screen.queryByText(FAILED_TIMES)).toBeNull();
    expect(screen.queryByRole('group', { name: /Response time/ })).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('does not treat an in-flight response-time read as an empty week', () => {
    // WHY: a slow stats read also has no attempts. A loading caption is not
    // a settled empty week, and it is not a failed load.
    policyQuery({ data: STORED, isLoading: false, isError: false, status: 'success' });
    statsQuery({ data: undefined, isLoading: true, isError: false, status: 'pending' });

    renderEditor();

    expect(screen.getByText(CHECKING_TIMES)).toBeTruthy();
    expect(screen.queryByText(EMPTY_TIMES)).toBeNull();
    expect(screen.queryByText('Loading response times…')).toBeNull();
    expect(screen.queryByText(FAILED_TIMES)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('keeps a failed response-time read on the error', () => {
    // WHY: a failed stats read is not evidence that the week had no
    // attempts. The error stays.
    policyQuery({ data: STORED, isLoading: false, isError: false, status: 'success' });
    statsQuery({ data: undefined, isLoading: false, isError: true, status: 'error' });

    renderEditor();

    expect(screen.getByRole('alert').textContent).toContain(FAILED_TIMES);
    expect(screen.queryByText(CHECKING_TIMES)).toBeNull();
    expect(screen.queryByText(EMPTY_TIMES)).toBeNull();
    expect(screen.queryByRole('group', { name: /Response time/ })).toBeNull();
  });

  it('lets a failed response-time read win over a stale sample', () => {
    // WHY: error wins before a payload. A refetch failure must not keep the
    // last histogram.
    policyQuery({ data: STORED, isLoading: false, isError: false, status: 'success' });
    statsQuery({
      data: { latencyMs: [900] },
      isLoading: false,
      isError: true,
      status: 'error',
    });

    renderEditor();

    expect(screen.getByRole('alert').textContent).toContain(FAILED_TIMES);
    expect(screen.queryByRole('group', { name: /Response time/ })).toBeNull();
    expect(screen.queryByText(CHECKING_TIMES)).toBeNull();
    expect(screen.queryByText(EMPTY_TIMES)).toBeNull();
  });

  it('stays empty when a settled week has no attempts', () => {
    // WHY: a stats read that arrived with no samples stays empty. A slow
    // network must not be dressed up as an empty week, and this one must.
    policyQuery({ data: STORED, isLoading: false, isError: false, status: 'success' });
    statsQuery({ data: { latencyMs: [] }, isLoading: false, isError: false, status: 'success' });

    renderEditor();

    expect(screen.getByText(EMPTY_TIMES)).toBeTruthy();
    expect(screen.queryByText(CHECKING_TIMES)).toBeNull();
    expect(screen.queryByText(FAILED_TIMES)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows loaded response times', () => {
    // WHY: loaded samples stay. The unread line must not replace a week the
    // read already returned.
    policyQuery({ data: STORED, isLoading: false, isError: false, status: 'success' });
    statsQuery({
      data: { latencyMs: [120, 340] },
      isLoading: false,
      isError: false,
      status: 'success',
    });

    renderEditor();

    expect(screen.getByRole('group', { name: /Response time/ })).toBeTruthy();
    expect(screen.queryByText(CHECKING_TIMES)).toBeNull();
    expect(screen.queryByText(FAILED_TIMES)).toBeNull();
    expect(screen.queryByText(EMPTY_TIMES)).toBeNull();
  });

  it('stays on the endpoint prompt when no endpoint is selected', () => {
    // WHY: an empty endpoint list is settled. A disabled policy read must
    // not turn that prompt into a checking line.
    policyQuery({ data: undefined, isLoading: false, isError: false, status: 'pending' });
    statsQuery({ data: undefined, isLoading: false, isError: false, status: 'pending' });

    renderEditor([]);

    expect(screen.getByText('Add an endpoint to set its retry schedule.')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(CHECKING_TIMES)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(FAILED_TIMES)).toBeNull();
  });
});

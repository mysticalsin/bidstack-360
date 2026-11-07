import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  useWebhookMessages: vi.fn(),
  useWebhookMessage: vi.fn(),
  useReplayWebhookMessage: vi.fn(),
  useHasPermission: vi.fn(),
  replay: vi.fn(),
  writeText: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback: string, vars?: Record<string, unknown>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_, n: string) => String(vars?.[n] ?? '')),
  }),
}));
vi.mock('@/hooks/useWebhookDeliveries', () => ({
  useWebhookMessages: m.useWebhookMessages,
  useWebhookMessage: m.useWebhookMessage,
  useReplayWebhookMessage: m.useReplayWebhookMessage,
}));
vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: m.useHasPermission }));
vi.mock('@/components/ui/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { MessageLog } from './MessageLog';

const SUB = { id: 's1', url: 'https://partner.example.com/hook' };
const ITEMS = [
  {
    id: 'm1',
    subscriptionId: 's1',
    url: SUB.url,
    event: 'lead.created',
    status: 'failed',
    attempts: 2,
    lastStatusCode: 503,
    lastDurationMs: 1200,
    replayOfId: null,
    createdAt: '2026-11-07T12:00:00.000Z',
  },
  {
    id: 'm2',
    subscriptionId: 's1',
    url: SUB.url,
    event: 'opportunity.created',
    status: 'succeeded',
    attempts: 1,
    lastStatusCode: 200,
    lastDurationMs: 140,
    replayOfId: null,
    createdAt: '2026-11-07T11:00:00.000Z',
  },
];
const DETAIL = {
  message: { ...ITEMS[0], payload: undefined },
  requestBody: '{"id":"m1","event":"lead.created"}',
  requestBodyTruncated: false,
  attempts: [
    {
      id: 'd1',
      attempt: 1,
      statusCode: 500,
      success: false,
      durationMs: 900,
      errorMessage: null,
      requestHeaders: { 'X-Polo-Signature': 't=1700000000,v1=****' },
      responseBody: '{"error":"boom"}',
      responseTruncated: false,
      createdAt: '2026-11-07T12:00:01.000Z',
    },
    {
      id: 'd2',
      attempt: 2,
      statusCode: 503,
      success: false,
      durationMs: 1200,
      errorMessage: null,
      requestHeaders: { 'X-Polo-Signature': 't=1700000000,v1=****' },
      responseBody: null,
      responseTruncated: false,
      createdAt: '2026-11-07T12:00:31.000Z',
    },
  ],
};

beforeEach(() => {
  m.useWebhookMessages.mockReturnValue({
    data: { items: ITEMS, nextCursor: null },
    isLoading: false,
    isError: false,
  });
  m.useWebhookMessage.mockImplementation((id: string | null) => ({
    data: id ? DETAIL : undefined,
    isLoading: false,
    isError: false,
  }));
  m.useReplayWebhookMessage.mockReturnValue({ mutateAsync: m.replay, isPending: false });
  m.replay.mockResolvedValue({ outboxId: 'o1', duplicate: false });
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: m.writeText },
    configurable: true,
  });
  m.writeText.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('MessageLog', () => {
  it('lists event, endpoint, status as text, attempts and latency per row', () => {
    m.useHasPermission.mockReturnValue(false);
    render(<MessageLog filters={{}} />);
    const row = screen.getByRole('row', { name: /lead\.created/ });
    expect(within(row).getByText('partner.example.com')).toBeTruthy();
    expect(within(row).getByText('Failed')).toBeTruthy();
    expect(within(row).getByText('2')).toBeTruthy();
    expect(within(row).getByText('1.2 s')).toBeTruthy();
    expect(screen.getByText('Delivered')).toBeTruthy();
  });

  it('opens a drawer with each attempt and copies a cURL without the signature', async () => {
    m.useHasPermission.mockReturnValue(false);
    render(<MessageLog filters={{}} />);
    fireEvent.click(screen.getByRole('button', { name: /Open lead\.created/ }));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('Attempt 1')).toBeTruthy();
    expect(within(drawer).getByText('Attempt 2')).toBeTruthy();
    expect(within(drawer).getByText('HTTP 500')).toBeTruthy();
    expect(within(drawer).getByText('{"error":"boom"}')).toBeTruthy();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Copy cURL' }));
    await waitFor(() => expect(m.writeText).toHaveBeenCalledOnce());
    const copied = m.writeText.mock.calls[0]![0] as string;
    expect(copied).toContain(SUB.url);
    expect(copied).toContain('v1=****');
  });

  it('hides Replay without webhooks:replay', async () => {
    m.useHasPermission.mockImplementation((k: string) => k !== 'webhooks:replay');
    render(<MessageLog filters={{}} />);
    fireEvent.click(screen.getByRole('button', { name: /Open lead\.created/ }));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).queryByRole('button', { name: 'Replay' })).toBeNull();
  });

  it('replays with a fresh request id and announces the result politely', async () => {
    m.useHasPermission.mockReturnValue(true);
    render(<MessageLog filters={{}} />);
    fireEvent.click(screen.getByRole('button', { name: /Open lead\.created/ }));
    const drawer = await screen.findByRole('dialog');
    fireEvent.click(within(drawer).getByRole('button', { name: 'Replay' }));
    await waitFor(() => expect(m.replay).toHaveBeenCalledOnce());
    const arg = m.replay.mock.calls[0]![0] as { id: string; requestId: string };
    expect(arg.id).toBe('m1');
    expect(arg.requestId).toMatch(/^[0-9a-f-]{36}$/);
    const live = await screen.findByText('Replay queued');
    expect(live.closest('[aria-live="polite"]')).not.toBeNull();
  });

  it('shows one sentence and no table when there are no messages', () => {
    m.useHasPermission.mockReturnValue(true);
    m.useWebhookMessages.mockReturnValue({
      data: { items: [], nextCursor: null },
      isLoading: false,
      isError: false,
    });
    render(<MessageLog filters={{}} />);
    expect(screen.getByText('No messages match these filters.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

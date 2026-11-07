import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({ api: vi.fn() }));

import { api } from '@/lib/api';

import { SyncNowControl } from './SyncNowControl';

const apiMock = vi.mocked(api);

function renderControl() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SyncNowControl source="dust" pollMs={10} />
    </QueryClientProvider>,
  );
}

const run = (over: Record<string, unknown>) => ({
  runId: 'dust-abc',
  source: 'dust',
  state: 'queued',
  progress: 0,
  startedAt: null,
  finishedAt: null,
  result: null,
  reasons: [],
  ...over,
});

beforeEach(() => {
  apiMock.mockReset();
});
afterEach(cleanup);

describe('SyncNowControl', () => {
  it('shows the button and the last synced time', async () => {
    apiMock.mockResolvedValueOnce({
      source: 'dust',
      lastSyncedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      lastRun: null,
    });
    renderControl();
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/5 minutes ago/)).toBeTruthy());
  });

  it('starts a run with an idempotency key, polls it, then shows the result', async () => {
    let polls = 0;
    apiMock.mockImplementation((async (path: string, opts?: { method?: string; headers?: Record<string, string> }) => {
      if (opts?.method === 'POST') return run({});
      if (path.includes('/runs/')) {
        polls += 1;
        return polls < 2
          ? run({ state: 'running', progress: 50 })
          : run({
              state: 'completed',
              progress: 100,
              finishedAt: new Date().toISOString(),
              result: { new: 3, updated: 2, skipped: 1, failed: 1 },
              reasons: ['Dust API 429'],
            });
      }
      return { source: 'dust', lastSyncedAt: null, lastRun: null };
    }) as never);

    renderControl();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    });

    const post = apiMock.mock.calls.find(([, o]) => (o as { method?: string })?.method === 'POST');
    expect(post?.[0]).toBe('/api/sync-now/dust');
    const headers = (post?.[1] as { headers?: Record<string, string> }).headers ?? {};
    expect(headers['Idempotency-Key']).toMatch(/^sync-dust-/);

    await waitFor(() => expect(screen.getByText('New')).toBeTruthy());
    const summary = screen.getByRole('list', { name: 'Sync result' });
    expect(summary.textContent).toContain('3');
    expect(summary.textContent).toContain('Updated');
    expect(summary.textContent).toContain('Skipped');
    expect(summary.textContent).toContain('Failed');
    expect(screen.getByText('Dust API 429')).toBeTruthy();
  });

  it('shows a progress row while the run is going', async () => {
    apiMock.mockImplementation((async (path: string, opts?: { method?: string }) => {
      if (opts?.method === 'POST') return run({ state: 'running', progress: 40 });
      if (path.includes('/runs/')) return run({ state: 'running', progress: 40 });
      return { source: 'dust', lastSyncedAt: null, lastRun: null };
    }) as never);
    renderControl();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    });
    const bar = await screen.findByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
    expect((screen.getByRole('button', { name: /sync/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('has no helper text or tagline', async () => {
    apiMock.mockResolvedValue({ source: 'dust', lastSyncedAt: null, lastRun: null });
    const { container } = renderControl();
    await waitFor(() => expect(screen.getByText('Never synced')).toBeTruthy());
    expect(container.querySelectorAll('p').length).toBe(0);
  });
});

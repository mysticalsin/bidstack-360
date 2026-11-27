// A paused or in-flight crew run has no status payload yet. The panel used
// the same "queued" word as a run the server had already recorded. The read
// has not arrived, so the run is not queued, empty, or available.
import type { ReactNode } from 'react';

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _key: string,
      fallback?: string | Record<string, unknown>,
      values?: Record<string, unknown>,
    ) => {
      const template = typeof fallback === 'string' ? fallback : _key;
      const vars = typeof fallback === 'object' && fallback ? fallback : values;
      if (!vars) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(vars[name] ?? ''));
    },
  }),
}));

vi.mock('@/lib/api', () => ({
  api: apiMock,
}));

vi.mock('@/lib/auth', () => ({
  useIsAdmin: () => true,
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: () => true,
}));

vi.mock('@/hooks/useDocumentTitle', () => ({
  useDocumentTitle: () => undefined,
}));

vi.mock('@/components/ui/Toast', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('@/components/ui/ConfirmDialog', () => ({
  confirm: vi.fn(),
}));

import { AgentStudioPage } from './AgentStudioPage';

const AGENTS_PATH = '/api/v1/crew-agents';
const CREWS_PATH = '/api/v1/crews';
const RUN_START_PATH = '/api/v1/crews/33333333-3333-4333-8333-333333333333/run';
const RUN_PATH = '/api/v1/crew-runs/44444444-4444-4444-8444-444444444444';
const RUN_ID = '44444444-4444-4444-8444-444444444444';
const QUEUED = 'queued';
const CHECKING = 'Checking the run. The status has not arrived.';
const FAILED = /Couldn.t load the run status/;
const FINAL = 'Synthetic coverage note for the unread run check.';
const RFP = 'Synthetic RFP excerpt for the unread run check.';
const APPROVAL = 'I reviewed this run and approve the listed agents to process this input.';

const AGENT = {
  id: '22222222-2222-4222-8222-222222222222',
  agentKey: 'coverage_reviewer',
  role: 'Coverage reviewer',
  goal: 'Review the coverage note',
  backstory: 'Synthetic reviewer for the unread-run check.',
  isStandard: false,
};

const CREW = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Coverage crew',
  description: null,
  process: 'sequential',
  taskCount: 1,
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'online' } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<AgentStudioPage />, { wrapper: Wrapper });
}

function hang(): Promise<never> {
  return new Promise(() => {});
}

function lists(path: string) {
  if (path === AGENTS_PATH) return { items: [AGENT] };
  if (path === CREWS_PATH) return { items: [CREW] };
  return null;
}

async function startRun() {
  fireEvent.click(await screen.findByRole('button', { name: 'Run' }));
  fireEvent.change(screen.getByLabelText('RFP text'), { target: { value: RFP } });
  fireEvent.click(screen.getByLabelText(APPROVAL));
  fireEvent.click(screen.getByRole('button', { name: 'Run crew' }));
}

describe('AgentStudioPage unread run', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    onlineManager.setOnline(true);
  });

  it('does not call a paused crew run queued', async () => {
    // WHY: a paused status read has isLoading false and no payload. The panel
    // said queued, while the run status has not arrived.
    onlineManager.setOnline(true);
    apiMock.mockImplementation((path: string, init?: { method?: string }) => {
      const listed = lists(path);
      if (listed) return Promise.resolve(listed);
      if (path === RUN_START_PATH && init?.method === 'POST') {
        onlineManager.setOnline(false);
        return Promise.resolve({ runId: RUN_ID, status: 'queued' });
      }
      if (path === RUN_PATH) return hang();
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPage();
    await startRun();

    expect(await screen.findByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(QUEUED)).toBeNull();
    expect(screen.queryByText(/available/i)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('does not call an in-flight crew run queued', async () => {
    // WHY: a slow status read is not a queued run, and it is not an empty result.
    onlineManager.setOnline(true);
    apiMock.mockImplementation((path: string, init?: { method?: string }) => {
      const listed = lists(path);
      if (listed) return Promise.resolve(listed);
      if (path === RUN_START_PATH && init?.method === 'POST') {
        return Promise.resolve({ runId: RUN_ID, status: 'queued' });
      }
      if (path === RUN_PATH) return hang();
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPage();
    await startRun();

    expect(await screen.findByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(QUEUED)).toBeNull();
    expect(screen.queryByText(/available/i)).toBeNull();
    expect(screen.queryByText(/no output/i)).toBeNull();
  });

  it('does not call a failed crew run queued', async () => {
    // WHY: a failed status read is not evidence the run is queued or empty.
    // The error stays, and the panel does not invent a status.
    apiMock.mockImplementation((path: string, init?: { method?: string }) => {
      const listed = lists(path);
      if (listed) return Promise.resolve(listed);
      if (path === RUN_START_PATH && init?.method === 'POST') {
        return Promise.resolve({ runId: RUN_ID, status: 'queued' });
      }
      if (path === RUN_PATH) return Promise.reject(new Error('network down'));
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPage();
    await startRun();

    expect(await screen.findByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(QUEUED)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(/available/i)).toBeNull();
    expect(screen.queryByText(/no output/i)).toBeNull();
  });

  it('still says a settled run is queued', async () => {
    // WHY: a payload that arrived as queued is a real queued run. That word
    // stays, so a recorded queue is not dressed up as a slow network.
    apiMock.mockImplementation((path: string, init?: { method?: string }) => {
      const listed = lists(path);
      if (listed) return Promise.resolve(listed);
      if (path === RUN_START_PATH && init?.method === 'POST') {
        return Promise.resolve({ runId: RUN_ID, status: 'queued' });
      }
      if (path === RUN_PATH) {
        return Promise.resolve({
          id: RUN_ID,
          status: 'queued',
          finalOutput: null,
          results: null,
          error: null,
        });
      }
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPage();
    await startRun();

    expect(await screen.findByText(QUEUED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('still shows a settled run that finished with output', async () => {
    // WHY: a loaded final response stays on the panel. The unread line must
    // not replace a note the read already returned.
    apiMock.mockImplementation((path: string, init?: { method?: string }) => {
      const listed = lists(path);
      if (listed) return Promise.resolve(listed);
      if (path === RUN_START_PATH && init?.method === 'POST') {
        return Promise.resolve({ runId: RUN_ID, status: 'queued' });
      }
      if (path === RUN_PATH) {
        return Promise.resolve({
          id: RUN_ID,
          status: 'completed',
          finalOutput: FINAL,
          results: [
            {
              taskId: 'coverage',
              agentId: 'coverage_reviewer',
              output: FINAL,
              ok: true,
            },
          ],
          error: null,
        });
      }
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPage();
    await startRun();

    expect((await screen.findAllByText(FINAL)).length).toBe(2);
    expect(screen.getByText('completed')).toBeTruthy();
    expect(screen.getAllByText('Coverage reviewer').length).toBeGreaterThan(0);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(QUEUED)).toBeNull();
  });

  it('still shows a settled run that finished with no output', async () => {
    // WHY: a payload that arrived empty is a finished run with nothing to
    // show. It is not an unread run, and it does not grow a fake empty label.
    apiMock.mockImplementation((path: string, init?: { method?: string }) => {
      const listed = lists(path);
      if (listed) return Promise.resolve(listed);
      if (path === RUN_START_PATH && init?.method === 'POST') {
        return Promise.resolve({ runId: RUN_ID, status: 'queued' });
      }
      if (path === RUN_PATH) {
        return Promise.resolve({
          id: RUN_ID,
          status: 'completed',
          finalOutput: null,
          results: [],
          error: null,
        });
      }
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPage();
    await startRun();

    expect(await screen.findByText('completed')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(/no output/i)).toBeNull();
    expect(screen.queryByText('Final response')).toBeNull();
  });
});

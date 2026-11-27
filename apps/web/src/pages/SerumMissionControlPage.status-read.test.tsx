// A paused or in-flight SERUM status has no snapshot yet. The mission page
// used the unavailable error, or a bare skeleton, in the same place a settled
// empty control plane says the ledger, heartbeats, queues, and gates are none.
// The status has not arrived, so those lines are not a finding.
import type { ReactNode } from 'react';

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SerumStatusSnapshot } from '@bidstack/shared';

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
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

import { SerumMissionControlPage } from './SerumMissionControlPage';

const STATUS_PATH = '/api/v1/serum/status';
const WAITING = 'Checking SERUM. The status has not arrived.';
const FAILED = 'SERUM status is unavailable';
const EVENT_EMPTY = 'No SERUM event ledger yet';
const PROVIDER_EMPTY = 'No provider heartbeat rows';
const QUEUE_EMPTY = 'No queue snapshots';
const AUDIT_NONE = 'None recorded';
const APPROVAL_NONE = 'No pending human gates from existing approval workflows.';
const LOADED_MODULE = 'Document intelligence';
const LOADED_PROVIDER = 'synthetic-provider';

function emptySnapshot(): SerumStatusSnapshot {
  return {
    generatedAt: '2026-11-26T04:00:00.000Z',
    environment: 'test',
    enabled: false,
    demoModeEnabled: false,
    summary: {
      activeAgents: 0,
      activeLoops: 0,
      documentsProcessedToday: 0,
      failedJobs: 0,
      openApprovals: 0,
      modelCallsToday: 0,
      modelTokensToday: 0,
      providerConfigured: false,
      dustConfigured: false,
      mcpConfigured: false,
      latestConfigChangeAt: null,
    },
    cards: [
      {
        id: 'agents',
        title: 'Crew agents',
        value: '0',
        detail: 'Configured agent personas in this organization.',
        status: 'empty',
      },
    ],
    modules: [
      {
        id: 'mission-control',
        label: 'Agent Mission Control',
        status: 'disabled',
        detail: 'Enable SERUM only after durable events, approvals, and policies are configured.',
      },
    ],
    providerHealth: [],
    queueHealth: [],
    signalHealth: [],
    guardrails: ['No fake production data or simulated agent activity.'],
  };
}

function loadedSnapshot(): SerumStatusSnapshot {
  const snapshot = emptySnapshot();
  snapshot.enabled = true;
  snapshot.summary.activeAgents = 4;
  snapshot.summary.activeLoops = 2;
  snapshot.summary.documentsProcessedToday = 3;
  snapshot.summary.openApprovals = 2;
  snapshot.summary.modelCallsToday = 5;
  snapshot.summary.modelTokensToday = 80;
  snapshot.summary.providerConfigured = true;
  snapshot.summary.latestConfigChangeAt = '2026-11-26T03:00:00.000Z';
  snapshot.cards = [
    {
      id: 'agents',
      title: 'Crew agents',
      value: '4',
      detail: 'Configured agent personas in this organization.',
      status: 'active',
    },
  ];
  snapshot.modules = [
    {
      id: 'document-intelligence',
      label: LOADED_MODULE,
      status: 'ready',
      detail: 'RFP document extraction is connected.',
    },
  ];
  snapshot.providerHealth = [
    {
      provider: LOADED_PROVIDER,
      status: 'ready',
      latencyMs: 40,
      lastCheckedAt: '2026-11-26T03:30:00.000Z',
      message: null,
    },
  ];
  snapshot.queueHealth = [
    {
      queueName: 'synthetic-queue',
      status: 'ready',
      waiting: 1,
      active: 1,
      failed: 0,
      completed: 6,
      lastCheckedAt: '2026-11-26T03:30:00.000Z',
    },
  ];
  return snapshot;
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'online' } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(<SerumMissionControlPage />, { wrapper: Wrapper });
}

function hang(): Promise<never> {
  return new Promise(() => {});
}

function expectNoSettledMiss() {
  expect(screen.queryByText(EVENT_EMPTY)).toBeNull();
  expect(screen.queryByText(PROVIDER_EMPTY)).toBeNull();
  expect(screen.queryByText(QUEUE_EMPTY)).toBeNull();
  expect(screen.queryByText(AUDIT_NONE)).toBeNull();
  expect(screen.queryByText(APPROVAL_NONE)).toBeNull();
  expect(screen.queryByText('0')).toBeNull();
  expect(screen.queryByText('Empty')).toBeNull();
}

describe('SerumMissionControlPage unread status', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    onlineManager.setOnline(true);
  });

  it('does not call a paused SERUM status an empty mission', async () => {
    // WHY: a paused first read has isLoading false and no snapshot. The page
    // said the control plane was unavailable, which is the failure copy, while
    // the status has not arrived. That is not an empty ledger or a zero count.
    onlineManager.setOnline(false);
    apiMock.mockImplementation(hang);

    renderPage();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expectNoSettledMiss();
  });

  it('does not call an in-flight SERUM status an empty mission', async () => {
    // WHY: the skeleton alone still sat where a settled empty control plane
    // sits. A slow read is not an empty ledger, and it does not count 0.
    onlineManager.setOnline(true);
    apiMock.mockImplementation(hang);

    renderPage();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expectNoSettledMiss();
  });

  it('does not call a failed SERUM status an empty mission', async () => {
    // WHY: a failed read is not evidence the ledger, heartbeats, or gates are
    // empty. The error stays, and the page does not say the read found none.
    apiMock.mockImplementation((path: string) => {
      if (path === STATUS_PATH) return Promise.reject(new Error('network down'));
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPage();

    expect(await screen.findByRole('heading', { name: FAILED })).toBeTruthy();
    expect(screen.queryByText(WAITING)).toBeNull();
    expectNoSettledMiss();
  });

  it('still says a settled status found none', async () => {
    // WHY: a payload that arrived empty is a miss. Those lines stay, so a real
    // empty control plane is not dressed up as a slow network.
    apiMock.mockImplementation((path: string) => {
      if (path === STATUS_PATH) return Promise.resolve(emptySnapshot());
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPage();

    expect(await screen.findByText(EVENT_EMPTY)).toBeTruthy();
    expect(screen.getByText(PROVIDER_EMPTY)).toBeTruthy();
    expect(screen.getByText(QUEUE_EMPTY)).toBeTruthy();
    expect(screen.getByText(AUDIT_NONE)).toBeTruthy();
    expect(screen.getByText(APPROVAL_NONE)).toBeTruthy();
    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.getByText('Empty')).toBeTruthy();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('still shows a status that has arrived', async () => {
    // WHY: a loaded module and a loaded provider stay on the page. The unread
    // line must not replace a name the read already returned.
    apiMock.mockImplementation((path: string) => {
      if (path === STATUS_PATH) return Promise.resolve(loadedSnapshot());
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPage();

    expect(await screen.findAllByText(LOADED_MODULE)).toHaveLength(2);
    expect(screen.getByText(LOADED_PROVIDER)).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(PROVIDER_EMPTY)).toBeNull();
    expect(screen.queryByText(QUEUE_EMPTY)).toBeNull();
    expect(screen.queryByText(AUDIT_NONE)).toBeNull();
    expect(screen.queryByText(APPROVAL_NONE)).toBeNull();
  });
});

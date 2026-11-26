// A paused or in-flight workflows list has no rows yet. The page used the
// same "No workflows yet" title as a settled empty catalog, and a settled
// empty catalog counts 0. The list has not arrived, so it is not empty.
import type { ReactNode } from 'react';

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Workflow } from '@bidstack/shared';

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

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: apiMock,
}));

import { WorkflowsPage } from './WorkflowsPage';

const LIST_PATH = '/api/workflows';
const CAPABILITIES_PATH = '/api/me/capabilities';
const NOT_FOUND = 'No workflows yet';
const ZERO = '0 workflows';
const WAITING = 'Checking workflows. The list has not arrived.';
const FAILED = 'Failed to load workflows';
const WORKFLOW_NAME = 'Renewal reminder';

const CAPABILITIES = {
  userId: 'user-1',
  orgId: '11111111-1111-4111-8111-111111111111',
  legacyRole: 'admin',
  roles: ['admin'],
  permissions: ['workflows:write'],
  isAdmin: true,
};

const WORKFLOW: Workflow = {
  id: '22222222-2222-4222-8222-222222222222',
  orgId: '11111111-1111-4111-8111-111111111111',
  name: WORKFLOW_NAME,
  description: null,
  active: true,
  triggerKind: 'manual',
  triggerConfig: {},
  actions: [],
  runCount: 3,
  lastRunAt: null,
  createdAt: '2026-01-15T15:00:00.000Z',
  updatedAt: '2026-01-15T16:00:00.000Z',
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'online' } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<WorkflowsPage />, { wrapper: Wrapper });
}

function hang(): Promise<never> {
  return new Promise(() => {});
}

function isWorkflowsList(path: string): boolean {
  return path === LIST_PATH;
}

function withCapabilities(
  workflows: (path: string) => Promise<unknown>,
): (path: string) => Promise<unknown> {
  return (path: string) => {
    if (path === CAPABILITIES_PATH) return Promise.resolve(CAPABILITIES);
    return workflows(path);
  };
}

describe('WorkflowsPage unread list', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    onlineManager.setOnline(true);
  });

  it('does not call a paused workflows list an empty catalog', async () => {
    // WHY: a paused first read has isLoading false and no rows. The page
    // said No workflows yet, while the list has not arrived.
    onlineManager.setOnline(false);
    apiMock.mockImplementation(hang);

    renderPage();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(screen.queryByText(ZERO)).toBeNull();
  });

  it('does not call an in-flight workflows list an empty catalog', async () => {
    // WHY: the skeleton alone still sat under a settled empty catalog. A slow
    // read is not an empty list, and it does not count 0 workflows.
    onlineManager.setOnline(true);
    apiMock.mockImplementation(hang);

    renderPage();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(screen.queryByText(ZERO)).toBeNull();
  });

  it('does not call a failed workflows list an empty catalog', async () => {
    // WHY: a failed read is not evidence the catalog is empty. The error
    // stays, and the page does not count 0 workflows.
    apiMock.mockImplementation(
      withCapabilities((path: string) => {
        if (isWorkflowsList(path)) return Promise.reject(new Error('network down'));
        return Promise.reject(new Error(`unhandled: ${path}`));
      }),
    );

    renderPage();

    expect(await screen.findByRole('heading', { name: FAILED })).toBeTruthy();
    expect(screen.getByText('network down')).toBeTruthy();
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(screen.queryByText(ZERO)).toBeNull();
    expect(screen.queryByText(WAITING)).toBeNull();
  });

  it('still says a settled list found none', async () => {
    // WHY: a payload that arrived empty is a miss. That line stays
    // No workflows yet, and the count stays 0, so a real empty catalog
    // is not dressed up as a slow network.
    apiMock.mockImplementation(
      withCapabilities((path: string) => {
        if (isWorkflowsList(path)) return Promise.resolve({ items: [], pageContinues: false });
        return Promise.reject(new Error(`unhandled: ${path}`));
      }),
    );

    renderPage();

    expect(await screen.findByText(NOT_FOUND)).toBeTruthy();
    expect(screen.getByText(ZERO)).toBeTruthy();
    expect(screen.queryByText(WAITING)).toBeNull();
  });

  it('still shows a workflow that has arrived', async () => {
    // WHY: a loaded workflow stays on the list. The unread line must not
    // replace a name the read already returned.
    apiMock.mockImplementation(
      withCapabilities((path: string) => {
        if (isWorkflowsList(path)) {
          return Promise.resolve({ items: [WORKFLOW], pageContinues: false });
        }
        return Promise.reject(new Error(`unhandled: ${path}`));
      }),
    );

    renderPage();

    expect(await screen.findByText(WORKFLOW_NAME)).toBeTruthy();
    expect(screen.getByText('1 workflow')).toBeTruthy();
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(screen.queryByText(WAITING)).toBeNull();
  });
});

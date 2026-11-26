// A paused, in-flight, or failed capabilities read has no permission yet.
// The workflow run controls used the same "you need workflows write access"
// denial as a settled grant check, and they hid New workflow. The permission
// has not arrived, so the run is not a denied action and it is not available.
import type { ReactNode } from 'react';

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
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

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: apiMock,
}));

import { WorkflowsPage } from './WorkflowsPage';

const LIST_PATH = '/api/workflows';
const CAPABILITIES_PATH = '/api/me/capabilities';
const WORKFLOW_NAME = 'Renewal reminder';
const DENIED = 'You need workflows write access to manage this workflow.';
const WAITING = 'Checking workflow access. The permission has not arrived.';
const FAILED = 'Could not check workflow access.';
const RUN = 'Run';
const NEW_WORKFLOW = 'New workflow';

const WORKFLOW = {
  id: '22222222-2222-4222-8222-222222222222',
  orgId: '11111111-1111-4111-8111-111111111111',
  name: WORKFLOW_NAME,
  description: null,
  active: true,
  triggerKind: 'manual',
  triggerConfig: {},
  actions: [] as Array<{ id: string; kind: string }>,
  runCount: 3,
  lastRunAt: null,
  createdAt: '2026-01-15T15:00:00.000Z',
  updatedAt: '2026-01-15T16:00:00.000Z',
};

const ALLOWED = {
  userId: 'user-1',
  orgId: '11111111-1111-4111-8111-111111111111',
  legacyRole: 'admin',
  roles: ['admin'],
  permissions: ['workflows:write'],
  isAdmin: true,
};

const DENIED_MANIFEST = {
  userId: 'user-1',
  orgId: '11111111-1111-4111-8111-111111111111',
  legacyRole: 'member',
  roles: ['member'],
  permissions: [] as string[],
  isAdmin: false,
};

function renderPage(client: QueryClient) {
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<WorkflowsPage />, { wrapper: Wrapper });
}

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'online' } },
  });
}

function hang(): Promise<never> {
  return new Promise(() => {});
}

function listReady(path: string): boolean {
  return path === LIST_PATH;
}

describe('WorkflowsPage unread access', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    onlineManager.setOnline(true);
  });

  it('does not call a paused access check a denied run', async () => {
    // WHY: a paused first read of capabilities has no manifest. The run
    // controls said you need workflows write access, while the permission
    // has not arrived, so Run looked unavailable for the wrong reason.
    const client = newClient();
    client.setQueryData(['workflows', undefined], { items: [WORKFLOW], pageContinues: false });
    onlineManager.setOnline(false);
    apiMock.mockImplementation(hang);

    renderPage(client);

    expect(await screen.findByText(WORKFLOW_NAME)).toBeTruthy();
    expect(screen.getByText(WAITING)).toBeTruthy();
    expect(screen.queryByText(DENIED)).toBeNull();
    expect(screen.queryByRole('button', { name: /^Run/ })).toBeNull();
    expect(screen.queryByRole('button', { name: NEW_WORKFLOW })).toBeNull();
    expect(screen.queryByRole('button', { name: /You need workflows write access/ })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /You need workflows write access/ })).toBeNull();
  });

  it('does not call an in-flight access check a denied run', async () => {
    // WHY: a slow capabilities read is not a settled denial. Run must not
    // look available, and it must not say the grant is missing.
    onlineManager.setOnline(true);
    apiMock.mockImplementation((path: string) => {
      if (listReady(path)) return Promise.resolve({ items: [WORKFLOW], pageContinues: false });
      if (path === CAPABILITIES_PATH) return hang();
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPage(newClient());

    expect(await screen.findByText(WORKFLOW_NAME)).toBeTruthy();
    expect(screen.getByText(WAITING)).toBeTruthy();
    expect(screen.queryByText(DENIED)).toBeNull();
    expect(screen.queryByRole('button', { name: /^Run/ })).toBeNull();
    expect(screen.queryByRole('button', { name: NEW_WORKFLOW })).toBeNull();
    expect(screen.queryByRole('button', { name: /You need workflows write access/ })).toBeNull();
  });

  it('does not call a failed access check a denied run', async () => {
    // WHY: a failed capabilities read is not evidence the grant is missing.
    // Run stays unavailable, and the denial copy stays off the card.
    apiMock.mockImplementation((path: string) => {
      if (listReady(path)) return Promise.resolve({ items: [WORKFLOW], pageContinues: false });
      if (path === CAPABILITIES_PATH) return Promise.reject(new Error('network down'));
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPage(newClient());

    expect(await screen.findByText(WORKFLOW_NAME)).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.getByText('network down')).toBeTruthy();
    expect(screen.queryByText(DENIED)).toBeNull();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByRole('button', { name: /^Run/ })).toBeNull();
    expect(screen.queryByRole('button', { name: NEW_WORKFLOW })).toBeNull();
  });

  it('still says a settled empty catalog found none while access is unread', async () => {
    // WHY: an empty workflow list that arrived is still empty. Hiding
    // New workflow without the checking line reads as no access. The empty
    // catalog stays, and the permission line says the check has not arrived.
    apiMock.mockImplementation((path: string) => {
      if (listReady(path)) return Promise.resolve({ items: [], pageContinues: false });
      if (path === CAPABILITIES_PATH) return hang();
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPage(newClient());

    expect(await screen.findByText('No workflows yet')).toBeTruthy();
    expect(screen.getByText(WAITING)).toBeTruthy();
    expect(screen.queryByText(DENIED)).toBeNull();
    expect(screen.queryByRole('button', { name: NEW_WORKFLOW })).toBeNull();
  });

  it('still denies a run when the grant arrived without workflows write', async () => {
    // WHY: a settled manifest that lacks the grant is a real denial. That
    // hint stays, and New workflow stays hidden, so a slow read is not the
    // only way the run stays unavailable.
    apiMock.mockImplementation((path: string) => {
      if (listReady(path)) return Promise.resolve({ items: [WORKFLOW], pageContinues: false });
      if (path === CAPABILITIES_PATH) return Promise.resolve(DENIED_MANIFEST);
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPage(newClient());

    expect(await screen.findByText(WORKFLOW_NAME)).toBeTruthy();
    const runButton = screen.getByRole('button', { name: /^Run/ }) as HTMLButtonElement;
    expect(runButton.disabled).toBe(true);
    expect(runButton.getAttribute('aria-label')).toContain(DENIED);
    expect(screen.queryByRole('button', { name: NEW_WORKFLOW })).toBeNull();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('still offers run when the grant has arrived', async () => {
    // WHY: a loaded grant with workflows write still offers Run and New
    // workflow. The unread line must not replace a permission that arrived.
    apiMock.mockImplementation((path: string) => {
      if (listReady(path)) return Promise.resolve({ items: [WORKFLOW], pageContinues: false });
      if (path === CAPABILITIES_PATH) return Promise.resolve(ALLOWED);
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPage(newClient());

    expect(await screen.findByText(WORKFLOW_NAME)).toBeTruthy();
    expect((screen.getByRole('button', { name: RUN }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole('button', { name: NEW_WORKFLOW })).toBeTruthy();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(DENIED)).toBeNull();
  });
});

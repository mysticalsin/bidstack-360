// A paused or in-flight agent studio list has no rows yet. The page used the
// same "No agents yet" and "No crews yet" titles as a settled empty catalog.
// The lists have not arrived, so they are not empty.
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
const NO_AGENTS = 'No agents yet';
const NO_CREWS = 'No crews yet';
const ZERO_AGENTS = '0 agents';
const ZERO_CREWS = '0 crews';
const WAITING_AGENTS = 'Checking agents. The list has not arrived.';
const WAITING_CREWS = 'Checking crews. The list has not arrived.';
const FAILED_AGENTS = 'Couldn\u2019t load agents';
const FAILED_CREWS = 'Couldn\u2019t load crews';
const AGENT_ROLE = 'Renewal reviewer';
const CREW_NAME = 'Renewal crew';

const AGENT = {
  id: '22222222-2222-4222-8222-222222222222',
  agentKey: 'renewal_reviewer',
  role: AGENT_ROLE,
  goal: 'Review the renewal note',
  backstory: 'Synthetic reviewer for the unread-list check.',
  isStandard: false,
};

const CREW = {
  id: '33333333-3333-4333-8333-333333333333',
  name: CREW_NAME,
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

function isStudioList(path: string): boolean {
  return path === AGENTS_PATH || path === CREWS_PATH;
}

describe('AgentStudioPage unread lists', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    onlineManager.setOnline(true);
  });

  it('does not call a paused agent studio list an empty catalog', async () => {
    // WHY: a paused first read has isLoading false and no rows. The page
    // said No agents yet and No crews yet, while the lists have not arrived.
    onlineManager.setOnline(false);
    apiMock.mockImplementation(hang);

    renderPage();

    expect(await screen.findByText(WAITING_AGENTS)).toBeTruthy();
    expect(screen.getByText(WAITING_CREWS)).toBeTruthy();
    expect(screen.queryByText(NO_AGENTS)).toBeNull();
    expect(screen.queryByText(NO_CREWS)).toBeNull();
    expect(screen.queryByText(ZERO_AGENTS)).toBeNull();
    expect(screen.queryByText(ZERO_CREWS)).toBeNull();
  });

  it('does not call an in-flight agent studio list an empty catalog', async () => {
    // WHY: the skeleton alone still sat where a settled empty catalog sits.
    // A slow read is not an empty list, and it does not count 0.
    onlineManager.setOnline(true);
    apiMock.mockImplementation(hang);

    renderPage();

    expect(await screen.findByText(WAITING_AGENTS)).toBeTruthy();
    expect(screen.getByText(WAITING_CREWS)).toBeTruthy();
    expect(screen.queryByText(NO_AGENTS)).toBeNull();
    expect(screen.queryByText(NO_CREWS)).toBeNull();
    expect(screen.queryByText(ZERO_AGENTS)).toBeNull();
    expect(screen.queryByText(ZERO_CREWS)).toBeNull();
  });

  it('does not call a failed agent studio list an empty catalog', async () => {
    // WHY: a failed read is not evidence the catalog is empty. The error
    // stays, and the page does not say the lists found none.
    apiMock.mockImplementation((path: string) => {
      if (isStudioList(path)) return Promise.reject(new Error('network down'));
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPage();

    expect(await screen.findByRole('heading', { name: FAILED_AGENTS })).toBeTruthy();
    expect(screen.getByRole('heading', { name: FAILED_CREWS })).toBeTruthy();
    expect(screen.getAllByText('network down')).toHaveLength(2);
    expect(screen.queryByText(NO_AGENTS)).toBeNull();
    expect(screen.queryByText(NO_CREWS)).toBeNull();
    expect(screen.queryByText(ZERO_AGENTS)).toBeNull();
    expect(screen.queryByText(ZERO_CREWS)).toBeNull();
    expect(screen.queryByText(WAITING_AGENTS)).toBeNull();
    expect(screen.queryByText(WAITING_CREWS)).toBeNull();
  });

  it('still says a settled list found none', async () => {
    // WHY: a payload that arrived empty is a miss. Those lines stay
    // No agents yet and No crews yet, so a real empty catalog is not
    // dressed up as a slow network.
    apiMock.mockImplementation((path: string) => {
      if (isStudioList(path)) return Promise.resolve({ items: [] });
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPage();

    expect(await screen.findByText(NO_AGENTS)).toBeTruthy();
    expect(screen.getByText(NO_CREWS)).toBeTruthy();
    expect(screen.queryByText(WAITING_AGENTS)).toBeNull();
    expect(screen.queryByText(WAITING_CREWS)).toBeNull();
  });

  it('still shows an agent and a crew that have arrived', async () => {
    // WHY: a loaded agent and a loaded crew stay on the page. The unread
    // lines must not replace a name the read already returned.
    apiMock.mockImplementation((path: string) => {
      if (path === AGENTS_PATH) return Promise.resolve({ items: [AGENT] });
      if (path === CREWS_PATH) return Promise.resolve({ items: [CREW] });
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPage();

    expect(await screen.findByText(AGENT_ROLE)).toBeTruthy();
    expect(screen.getByText(CREW_NAME)).toBeTruthy();
    expect(screen.queryByText(NO_AGENTS)).toBeNull();
    expect(screen.queryByText(NO_CREWS)).toBeNull();
    expect(screen.queryByText(WAITING_AGENTS)).toBeNull();
    expect(screen.queryByText(WAITING_CREWS)).toBeNull();
  });
});

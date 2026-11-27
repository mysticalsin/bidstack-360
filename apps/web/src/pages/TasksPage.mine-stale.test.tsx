// The demo book files the Siemens volume on the first visitor and the IKEA
// annex on the second. Mine must follow the address stored for this demo
// session. A stale auth snapshot, and a later session swap, must not keep
// the previous person's row or the whole-page active count.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AUTH_FINGERPRINT_EVENT } from '@/lib/queryCache';
import { TasksPage } from './TasksPage';
import { useTasks } from '@/hooks/useTasks';
import type { Task } from '@bidstack/shared';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) => {
      if (!opts) return fallback;
      return Object.entries(opts).reduce(
        (str, [k, v]) => str.replace(`{{${k}}}`, String(v)),
        fallback,
      );
    },
  }),
}));

vi.mock('@/hooks/useTasks', () => ({
  useTasks: vi.fn(),
  useCreateTask: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateTask: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

const capabilitiesMocks = vi.hoisted(() => ({ useHasPermission: vi.fn(() => true) }));
vi.mock('@/hooks/useCapabilities', () => capabilitiesMocks);

const viewer = vi.hoisted(() => ({ email: 'visitor.one@example.test' as string | null }));
vi.mock('@/lib/auth', () => ({
  useUser: () => ({
    user: viewer.email
      ? { primaryEmailAddress: { emailAddress: viewer.email } }
      : null,
  }),
  DEMO_EMAIL_KEY: 'bidstack:demo-email',
  DEMO_TOKEN_KEY: 'bidstack:demo-token',
}));

vi.mock('@/hooks/useOpportunities', () => ({
  useOpportunities: vi.fn(() => ({ data: { items: [] }, isLoading: false })),
}));

const FIRST = 'visitor.one@example.test';
const SECOND = 'visitor.two@example.test';
const DEMO_EMAIL_KEY = 'bidstack:demo-email';
const DEMO_TOKEN_KEY = 'bidstack:demo-token';

const SIEMENS: Task = {
  id: '00000000-0000-4000-8000-000000010011',
  oppId: '00000000-0000-4000-8000-000000020001',
  title: 'Finalize technical volume for Siemens ERP',
  dueDate: '2026-11-30',
  status: 'in_progress',
  assignee: FIRST,
  createdAt: '2026-11-20T00:00:00.000Z',
};

const IKEA: Task = {
  id: '00000000-0000-4000-8000-000000010012',
  oppId: '00000000-0000-4000-8000-000000020002',
  title: 'Prepare pricing annex for IKEA',
  dueDate: '2026-11-28',
  status: 'open',
  assignee: SECOND,
  createdAt: '2026-11-21T00:00:00.000Z',
};

const STELLANTIS: Task = {
  id: '00000000-0000-4000-8000-000000010015',
  oppId: '00000000-0000-4000-8000-000000020005',
  title: 'Kickoff handover to delivery, Stellantis',
  dueDate: '2026-11-23',
  status: 'done',
  assignee: SECOND,
  createdAt: '2026-11-22T00:00:00.000Z',
};

function mockTasks(items: Task[]) {
  vi.mocked(useTasks).mockReturnValue({
    data: { items, nextCursor: null },
    isLoading: false,
    isError: false,
    error: null,
  } as ReturnType<typeof useTasks>);
}

function renderPage(path = '/tasks?filter=mine') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <TasksPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TasksPage Mine follows the demo session, not a stale snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    viewer.email = FIRST;
    capabilitiesMocks.useHasPermission.mockReturnValue(true);
    mockTasks([SIEMENS, IKEA, STELLANTIS]);
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('shows the session address when auth still names the previous visitor', () => {
    viewer.email = FIRST;
    localStorage.setItem(DEMO_TOKEN_KEY, 'demo-session');
    localStorage.setItem(DEMO_EMAIL_KEY, SECOND);

    renderPage();

    expect(screen.getByRole('button', { name: 'Mine', pressed: true })).toBeTruthy();
    expect(screen.getByText('Prepare pricing annex for IKEA')).toBeTruthy();
    expect(screen.queryByText('Finalize technical volume for Siemens ERP')).toBeNull();
    expect(screen.getByText('2 of your follow-ups.')).toBeTruthy();
    expect(screen.queryByText('3 active follow-ups.')).toBeNull();
  });

  it('drops the previous visitor when the demo session address changes', () => {
    viewer.email = FIRST;
    localStorage.setItem(DEMO_TOKEN_KEY, 'demo-session');
    localStorage.setItem(DEMO_EMAIL_KEY, FIRST);

    renderPage();

    expect(screen.getByText('Finalize technical volume for Siemens ERP')).toBeTruthy();
    expect(screen.queryByText('Prepare pricing annex for IKEA')).toBeNull();

    localStorage.setItem(DEMO_EMAIL_KEY, SECOND);
    fireEvent(window, new Event(AUTH_FINGERPRINT_EVENT));

    expect(screen.getByText('Prepare pricing annex for IKEA')).toBeTruthy();
    expect(screen.getByText('Kickoff handover to delivery, Stellantis')).toBeTruthy();
    expect(screen.queryByText('Finalize technical volume for Siemens ERP')).toBeNull();
    expect(screen.getByText('2 of your follow-ups.')).toBeTruthy();
  });

  it('keeps the auth address when a demo email is stored without a session token', () => {
    // A leftover address from an old demo visit must not hide the signed-in rows.
    viewer.email = FIRST;
    localStorage.setItem(DEMO_EMAIL_KEY, SECOND);

    renderPage();

    expect(screen.getByText('Finalize technical volume for Siemens ERP')).toBeTruthy();
    expect(screen.queryByText('Prepare pricing annex for IKEA')).toBeNull();
    expect(screen.getByText('1 of your follow-ups.')).toBeTruthy();
  });

  it('does not open the whole book when the viewer address is missing', () => {
    viewer.email = null;

    renderPage();

    expect(screen.getAllByText("Couldn't tell which follow-ups are yours.").length).toBeGreaterThan(0);
    expect(screen.queryByText('Finalize technical volume for Siemens ERP')).toBeNull();
    expect(screen.queryByText('Prepare pricing annex for IKEA')).toBeNull();
    expect(screen.queryByLabelText('Quick-add task title')).toBeNull();
  });
});

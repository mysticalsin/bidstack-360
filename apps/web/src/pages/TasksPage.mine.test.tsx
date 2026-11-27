// Alex owns "Submit revised pricing & SoW v2". Blake owns the Logistec
// workshop. The tasks list showed both, and nothing on the page kept only
// Alex's follow-up. Mine is that cut. An empty Mine view must say the loaded
// rows belong to other people, and must not offer a quick-add that files an
// unassigned follow-up the filter will not show.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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

const viewer = vi.hoisted(() => ({ email: 'alex.example@example.test' as string | null }));
vi.mock('@/lib/auth', () => ({
  useUser: () => ({
    user: viewer.email ? { primaryEmailAddress: { emailAddress: viewer.email } } : null,
  }),
}));

vi.mock('@/hooks/useOpportunities', () => ({
  useOpportunities: vi.fn(() => ({ data: { items: [] }, isLoading: false })),
}));

const ALEX = 'alex.example@example.test';
const BLAKE = 'blake.sample@example.test';

const PRICING: Task = {
  id: '00000000-0000-4000-8000-000000010001',
  oppId: '00000000-0000-4000-8000-000000020041',
  title: 'Submit revised pricing & SoW v2',
  dueDate: '2026-05-15',
  status: 'in_progress',
  assignee: ALEX,
  createdAt: '2026-05-01T00:00:00.000Z',
};

const LOGISTEC: Task = {
  id: '00000000-0000-4000-8000-000000010002',
  oppId: '00000000-0000-4000-8000-000000020042',
  title: 'Workshop with Logistec CISO',
  dueDate: '2026-05-20',
  status: 'open',
  assignee: BLAKE,
  createdAt: '2026-05-01T00:00:00.000Z',
};

function mockTasks(items: Task[]) {
  vi.mocked(useTasks).mockReturnValue({
    data: { items, nextCursor: null },
    isLoading: false,
    isError: false,
    error: null,
  } as ReturnType<typeof useTasks>);
}

function renderPage(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <TasksPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TasksPage — Mine keeps the signed-in owner’s follow-ups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewer.email = ALEX;
    capabilitiesMocks.useHasPermission.mockReturnValue(true);
    mockTasks([PRICING, LOGISTEC]);
  });

  afterEach(() => {
    cleanup();
  });

  it('opens on Alex’s pricing follow-up and leaves Blake’s workshop out', () => {
    renderPage('/tasks?filter=mine');

    expect(screen.getByRole('button', { name: 'Mine', pressed: true })).toBeTruthy();
    expect(screen.getByText('Submit revised pricing & SoW v2')).toBeTruthy();
    expect(screen.queryByText('Workshop with Logistec CISO')).toBeNull();
    expect(screen.queryByText('None of these follow-ups are yours')).toBeNull();
  });

  it('cuts to Mine from All', () => {
    renderPage('/tasks');

    expect(screen.getByText('Workshop with Logistec CISO')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Mine' }));

    expect(screen.getByText('Submit revised pricing & SoW v2')).toBeTruthy();
    expect(screen.queryByText('Workshop with Logistec CISO')).toBeNull();
  });

  it('says the loaded follow-ups belong to someone else and hides quick-add', () => {
    viewer.email = ALEX;
    mockTasks([LOGISTEC]);

    renderPage('/tasks?filter=mine');

    expect(screen.getByText('None of these follow-ups are yours')).toBeTruthy();
    expect(screen.queryByText('Workshop with Logistec CISO')).toBeNull();
    expect(screen.queryByText('Nothing on the bid clock')).toBeNull();
    expect(screen.queryByLabelText('Quick-add task title')).toBeNull();
  });

  it('says when it cannot tell who the viewer is', () => {
    viewer.email = null;
    mockTasks([PRICING]);

    renderPage('/tasks?filter=mine');

    expect(screen.getByText("Couldn't tell which follow-ups are yours.")).toBeTruthy();
    expect(screen.queryByText('Submit revised pricing & SoW v2')).toBeNull();
  });

  it('keeps quick-add when the list is All', () => {
    renderPage('/tasks');

    expect(screen.getByLabelText('Quick-add task title')).toBeTruthy();
    expect(screen.queryByText('None of these follow-ups are yours')).toBeNull();
  });
});

// The demo pricing follow-up is due 15 May 2026. Edit on its record changes
// the title and the status. The due day is not a field, so the save cannot
// move it. A rename must still send only the title.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TaskDetailPage } from './TaskDetailPage';
import { useTasks, useUpdateTask } from '@/hooks/useTasks';
import type { Task } from '@bidstack/shared';

const PRICING_ID = '00000000-0000-4000-8000-000000010001';

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

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: PRICING_ID }),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

vi.mock('@/hooks/useTasks', () => ({
  useTasks: vi.fn(),
  useUpdateTask: vi.fn(),
}));

const capabilitiesMocks = vi.hoisted(() => ({ useHasPermission: vi.fn(() => true) }));
vi.mock('@/hooks/useCapabilities', () => capabilitiesMocks);

vi.mock('@/components/ui/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/components/CustomFieldValuesSection', () => ({
  CustomFieldValuesSection: () => null,
}));

const PRICING: Task = {
  id: PRICING_ID,
  oppId: '00000000-0000-4000-8000-000000020041',
  title: 'Submit revised pricing & SoW v2',
  dueDate: '2026-05-15',
  status: 'in_progress',
  assignee: 'alex.example@example.test',
  createdAt: '2026-05-01T00:00:00.000Z',
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TaskDetailPage />
    </QueryClientProvider>,
  );
}

describe('TaskDetailPage — reschedule the due day', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  function load(mutate = vi.fn()) {
    capabilitiesMocks.useHasPermission.mockReturnValue(true);
    vi.mocked(useTasks).mockReturnValue({
      data: { items: [PRICING], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useTasks>);
    vi.mocked(useUpdateTask).mockReturnValue({
      mutate,
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateTask>);
    renderPage();
    return mutate;
  }

  it('sends the new due day for the May demo follow-up and not its title or status', () => {
    const mutate = load();

    expect(screen.queryByLabelText('Due date')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    const due = screen.getByLabelText('Due date') as HTMLInputElement;
    expect(due.value).toBe('2026-05-15');
    fireEvent.change(due, { target: { value: '2026-12-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mutate).toHaveBeenCalledWith(
      { id: PRICING_ID, patch: { dueDate: '2026-12-01' } },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it('clears the due day when the date field is emptied', () => {
    const mutate = load();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mutate).toHaveBeenCalledWith(
      { id: PRICING_ID, patch: { dueDate: null } },
      expect.any(Object),
    );
  });

  it('does not reschedule when the save only renames the follow-up', () => {
    const mutate = load();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Task title'), {
      target: { value: 'Submit revised pricing & SoW v3' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mutate).toHaveBeenCalledWith(
      { id: PRICING_ID, patch: { title: 'Submit revised pricing & SoW v3' } },
      expect.any(Object),
    );
  });
});

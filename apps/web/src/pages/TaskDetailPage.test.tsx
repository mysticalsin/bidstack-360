// Regression test for the silent-failure bug: TaskDetailPage.save() called
// update.mutate() with no onSuccess/onError and unconditionally closed the
// editor right after — a rejected PATCH (e.g. invalid status) reverted the
// optimistic UI with zero feedback. Fix mirrors TaskRow.tsx's cycle()/
// snoozeTo() pattern: toast.error on failure, setEditing(false) only on
// success.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskDetailPage } from './TaskDetailPage';
import { toast } from '@/components/ui/Toast';
import { useTasks, useUpdateTask } from '@/hooks/useTasks';
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

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 't1' }),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

vi.mock('@/hooks/useTasks', () => ({
  useTasks: vi.fn(),
  useUpdateTask: vi.fn(),
}));

const capabilitiesMocks = vi.hoisted(() => ({ useHasPermission: vi.fn(() => true) }));
// Edit is gated server-side behind tasks:write (PATCH /api/tasks/:id) —
// default to full access so the existing save-flow tests below (which
// don't care about permission) keep reaching the editor; the dedicated
// describe block overrides per-test.
vi.mock('@/hooks/useCapabilities', () => capabilitiesMocks);

vi.mock('@/components/ui/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/components/CustomFieldValuesSection', () => ({
  CustomFieldValuesSection: () => null,
}));

const TASK: Task = {
  id: 't1',
  oppId: null,
  title: 'Send follow-up email',
  dueDate: '2026-12-01',
  status: 'open',
  assignee: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TaskDetailPage />
    </QueryClientProvider>,
  );
}

describe('TaskDetailPage — save() error surfacing', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  beforeEach(() => {
    capabilitiesMocks.useHasPermission.mockReturnValue(true);
  });

  it('keeps the editor open and toasts when the PATCH is rejected, instead of silently reverting', () => {
    vi.mocked(useTasks).mockReturnValue({
      data: { items: [TASK], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useTasks>);

    const mutate = vi.fn(
      (
        _vars: unknown,
        opts?: { onSuccess?: () => void; onError?: (err: unknown) => void },
      ) => {
        opts?.onError?.(new Error('body/status Invalid enum value'));
      },
    );
    vi.mocked(useUpdateTask).mockReturnValue({
      mutate,
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateTask>);

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const titleInput = screen.getByLabelText('Task title');
    fireEvent.change(titleInput, { target: { value: 'Send follow-up call' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mutate).toHaveBeenCalledWith(
      { id: 't1', patch: { title: 'Send follow-up call' } },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
    expect(toast.error).toHaveBeenCalledWith(
      'Could not update task',
      expect.objectContaining({ description: 'body/status Invalid enum value' }),
    );
    // The editor must still be open — the old code called setEditing(false)
    // unconditionally, closing the form even though the save failed.
    expect(screen.getByLabelText('Task title')).toBeTruthy();
  });

  it('closes the editor once the save succeeds', () => {
    vi.mocked(useTasks).mockReturnValue({
      data: { items: [TASK], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useTasks>);

    const mutate = vi.fn(
      (_vars: unknown, opts?: { onSuccess?: () => void; onError?: (err: unknown) => void }) => {
        opts?.onSuccess?.();
      },
    );
    vi.mocked(useUpdateTask).mockReturnValue({
      mutate,
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateTask>);

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Task title'), {
      target: { value: 'Send follow-up call' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Task title')).toBeNull();
    expect(screen.getByText('Send follow-up email')).toBeTruthy();
  });
});

// Regression: PATCH /api/tasks/:id is gated server-side behind tasks:write —
// the Edit control must stay disabled (not just visually) for a user without
// it, otherwise a role like Presales sees an editable form that 403s on save.
describe('TaskDetailPage — tasks:write gating', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  function mockLoadedTask() {
    vi.mocked(useTasks).mockReturnValue({
      data: { items: [TASK], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useTasks>);
    vi.mocked(useUpdateTask).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateTask>);
  }

  it('enables the Edit control for a user with tasks:write (e.g. Admin)', () => {
    capabilitiesMocks.useHasPermission.mockReturnValue(true);
    mockLoadedTask();

    renderPage();

    const editButton = screen.getByRole('button', { name: 'Edit' });
    expect((editButton as HTMLButtonElement).disabled).toBe(false);
  });

  it('disables the Edit control with a hint for a user without tasks:write', () => {
    capabilitiesMocks.useHasPermission.mockReturnValue(false);
    mockLoadedTask();

    renderPage();

    // Read access stays intact — the task still renders.
    expect(screen.getByText('Send follow-up email')).toBeTruthy();

    const editButton = screen.getByRole('button', { name: 'Edit' });
    expect((editButton as HTMLButtonElement).disabled).toBe(true);
    expect(editButton.getAttribute('title')).toBe(
      'You need task write access to edit this task.',
    );
    // Disabled means unreachable — the title editor never mounts.
    fireEvent.click(editButton);
    expect(screen.queryByLabelText('Task title')).toBeNull();
  });
});

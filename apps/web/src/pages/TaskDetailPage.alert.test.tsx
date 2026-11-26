// WHY: a stored task alert opens /tasks/<id>. The record page read only the
// first tasks page (50 rows). The hourly scan alerts up to 1000 due or
// overdue follow-ups. Past that first page, the demo follow-up
// "Submit revised pricing & SoW v2" (due 15 May 2026) rendered as
// "Task not found" while the bell still counted the alert.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { ApiError, api } from '@/lib/api';
import { useTasks, useUpdateTask } from '@/hooks/useTasks';

import { TaskDetailPage } from './TaskDetailPage';

const FIXTURE_ID = '00000000-0000-4000-8000-000000010001';
const FIXTURE_TITLE = 'Submit revised pricing & SoW v2';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: vi.fn() };
});

vi.mock('@/hooks/useTasks', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useTasks')>('@/hooks/useTasks');
  return {
    ...actual,
    useTasks: vi.fn(() => ({
      data: { items: [], nextCursor: 'more' },
      isLoading: false,
      isError: false,
      error: null,
    })),
    useUpdateTask: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: () => true,
}));

vi.mock('@/components/CustomFieldValuesSection', () => ({
  CustomFieldValuesSection: () => null,
}));

function renderRecord() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/tasks/${FIXTURE_ID}`]}>
        <Routes>
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('task alert record', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(api).mockReset();
  });

  it('shows the demo follow-up when it is not on the first tasks page', async () => {
    vi.mocked(api).mockResolvedValue({
      id: FIXTURE_ID,
      oppId: null,
      title: FIXTURE_TITLE,
      dueDate: '2026-05-15',
      status: 'in_progress',
      assignee: 'alex.example@example.test',
      createdAt: '2026-05-01T00:00:00.000Z',
    });
    vi.mocked(useTasks).mockReturnValue({
      data: { items: [], nextCursor: 'more' },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useTasks>);
    vi.mocked(useUpdateTask).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateTask>);

    renderRecord();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: FIXTURE_TITLE })).toBeTruthy();
    });
    expect(screen.queryByText('Task not found')).toBeNull();
    expect(api).toHaveBeenCalledWith(
      `/api/tasks/${FIXTURE_ID}`,
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('says the follow-up is gone only when the record read answers 404', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Task not found', 404, null));
    renderRecord();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Task not found' })).toBeTruthy();
    });
    expect(screen.queryByText('Failed to load task')).toBeNull();
    expect(screen.queryByRole('heading', { name: FIXTURE_TITLE })).toBeNull();
  });

  it('does not call a failed record read a missing follow-up', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Server error', 500, null));
    renderRecord();

    await waitFor(() => {
      expect(screen.getByText('Failed to load task')).toBeTruthy();
    });
    expect(screen.queryByText('Task not found')).toBeNull();
  });
});

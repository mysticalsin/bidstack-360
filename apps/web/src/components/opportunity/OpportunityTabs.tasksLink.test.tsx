// Deal Tasks tab. Demo follow-ups such as "Submit revised pricing & SoW v2"
// are stored with a task id, but the title is plain text. Opening that
// follow-up means leaving the deal and searching Tasks, which can match a
// different row.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import type { Task } from '@bidstack/shared';

import { OpportunityTabs } from './OpportunityTabs';

const OPP_ID = '00000000-0000-4000-8000-0000000000aa';
const PRICING = '00000000-0000-4000-8000-000000010001';

const hookMocks = vi.hoisted(() => ({
  data: undefined as { items: Task[]; nextCursor: string | null } | undefined,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values[key] ?? ''));
    },
  }),
}));

vi.mock('@/lib/api', () => ({
  api: vi.fn().mockResolvedValue({ items: [] }),
}));

vi.mock('@/hooks/useTasks', () => ({
  useTasks: () => hookMocks,
}));

vi.mock('@/components/signatures/SendForSignatureModal', () => ({
  SendForSignatureModal: () => null,
}));

function task(partial: Pick<Task, 'id' | 'title' | 'status' | 'dueDate'> & Partial<Task>): Task {
  return {
    oppId: OPP_ID,
    assignee: 'jordan@northwind.example',
    createdAt: '2026-05-01T00:00:00.000Z',
    ...partial,
  };
}

function renderTasks() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <OpportunityTabs oppId={OPP_ID} customer="Northwind Synthetic" />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Tasks' }));
}

afterEach(() => {
  cleanup();
  hookMocks.data = undefined;
  hookMocks.isLoading = false;
  hookMocks.isError = false;
});

describe('deal task titles', () => {
  it('opens the follow-up record from the task title', () => {
    // WHY: this tab is the bid's follow-up list. The title is the only way
    // onto the record. Leaving it as text forces a search that can match
    // another follow-up.
    hookMocks.data = {
      nextCursor: null,
      items: [
        task({
          id: PRICING,
          title: 'Submit revised pricing & SoW v2',
          status: 'in_progress',
          dueDate: '2026-05-15',
        }),
      ],
    };

    renderTasks();

    const link = screen.getByRole('link', { name: /Submit revised pricing & SoW v2/ });
    expect(link.getAttribute('href')).toBe(`/tasks/${PRICING}`);
    expect(link.textContent).toContain('open follow-up');
    expect(link.className).toContain('min-h-11');
    expect(link.className).toContain('focus-visible:ring-2');
    expect(link.className).toContain('dark:text-[var(--brand-deep)]');
  });

  it('keeps a title as text when the id is not a task id', () => {
    // WHY: the address is the id, never the title. A script, a path, or a
    // title must not become the href.
    hookMocks.data = {
      nextCursor: null,
      items: [
        task({
          id: 'javascript:alert(1)',
          title: 'Submit revised pricing & SoW v2',
          status: 'open',
          dueDate: '2026-05-15',
        }),
      ],
    };

    renderTasks();

    expect(screen.getByText('Submit revised pricing & SoW v2')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

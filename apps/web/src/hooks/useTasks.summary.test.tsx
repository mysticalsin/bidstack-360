import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => vi.fn(async () => ({ total: 8, open: 8, overdue: 8, dueSoon: 0 })));
const other = vi.hoisted(() => vi.fn(async () => ({ ok: true })));

vi.mock('@/lib/api', () => ({
  api,
}));

import { useTaskSummary } from './useTasks';

describe('useTaskSummary', () => {
  afterEach(() => {
    api.mockClear();
    other.mockClear();
  });

  it('refetches the badge when navigation mounts it again inside the old stale window', async () => {
    // WHY: the sidebar unmounts the summary observer on some navigations.
    // A 30s staleTime served the previous overdue count (7) while the list
    // request, which has no staleTime, already returned 8.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
    const first = renderHook(() => useTaskSummary(), { wrapper });
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    first.unmount();
    renderHook(() => useTaskSummary(), { wrapper });
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
  });

  it('refetches the badge when the route changes and the sidebar stays mounted', async () => {
    // WHY: the sidebar never remounts, so the summary observer keeps the count
    // from the previous page. A task created elsewhere must show up on the
    // next navigation, and that navigation must not refetch unrelated queries.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function StayMounted() {
      const navigate = useNavigate();
      useTaskSummary();
      useQuery({ queryKey: ['companies'], queryFn: () => other() });
      return (
        <button type="button" onClick={() => navigate('/companies')}>
          Open companies
        </button>
      );
    }
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/tasks']}>
          <Routes>
            <Route path="*" element={<StayMounted />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(other).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Open companies' }));
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    expect(other).toHaveBeenCalledTimes(1);
  });
});

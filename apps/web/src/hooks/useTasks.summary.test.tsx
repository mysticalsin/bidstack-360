import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => vi.fn(async () => ({ total: 8, open: 8, overdue: 8, dueSoon: 0 })));

vi.mock('@/lib/api', () => ({
  api,
}));

import { useTaskSummary } from './useTasks';

describe('useTaskSummary', () => {
  afterEach(() => {
    api.mockClear();
  });

  it('refetches the badge when navigation mounts it again inside the old stale window', async () => {
    // WHY: the sidebar unmounts the summary observer on some navigations.
    // A 30s staleTime served the previous overdue count (7) while the list
    // request, which has no staleTime, already returned 8.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const first = renderHook(() => useTaskSummary(), { wrapper });
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    first.unmount();
    renderHook(() => useTaskSummary(), { wrapper });
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';
import { useChecklistTemplateInstalled, useInstallTemplate } from './useOnboarding';

vi.mock('@/lib/api', () => ({ api: vi.fn(async () => ({})) }));

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: 3, retryDelay: 0 }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useChecklistTemplateInstalled', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
  });

  it('reads the sample-data flag a template install leaves behind', async () => {
    vi.mocked(api).mockResolvedValue({ hasSampleData: true });
    const { result } = renderHook(() => useChecklistTemplateInstalled(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(true);
    expect(api).toHaveBeenCalledWith(
      '/api/onboarding/sample-data/status',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('does not retry a denied read, so a missing install is not invented', async () => {
    vi.mocked(api).mockRejectedValue(Object.assign(new Error('denied'), { status: 403 }));
    const { result } = renderHook(() => useChecklistTemplateInstalled(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('refetches the checklist flag after a template install', async () => {
    vi.mocked(api).mockImplementation(async (url: string) => {
      if (String(url).includes('sample-data/status')) return { hasSampleData: false };
      return {
        pipelineId: '11111111-1111-1111-1111-111111111111',
        stagesCreated: 4,
        leadsCreated: 3,
        dealsCreated: 2,
        tasksCreated: 1,
        notesCreated: 1,
      };
    });
    const { result } = renderHook(
      () => ({
        status: useChecklistTemplateInstalled(),
        install: useInstallTemplate(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.status.isSuccess).toBe(true));
    result.current.install.mutate('B2B_SAAS');
    await waitFor(() => {
      const statusCalls = vi
        .mocked(api)
        .mock.calls.filter((call) => String(call[0]).includes('sample-data/status'));
      expect(statusCalls.length).toBeGreaterThanOrEqual(2);
    });
  });
});

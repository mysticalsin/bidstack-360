import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, api } from '@/lib/api';
import { useRetryMigration, useStartCsvImport } from './useMigrations';

vi.mock('@/lib/api', () => ({
  api: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    body: unknown;
    constructor(message: string, status: number, body: unknown) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.body = body;
    }
  },
}));

/**
 * The app client retries a mutation once when the status is 500. A CSV start
 * creates a job, so that retry is a second request from one click.
 */
function appClient() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: {
        retry: (failureCount, error) => {
          if (failureCount >= 1) return false;
          if (error instanceof ApiError) return error.status >= 500 || error.status === 0;
          return true;
        },
        retryDelay: 0,
      },
    },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper };
}

describe('useStartCsvImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends a failed start once', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('down', 500, null));
    const { wrapper } = appClient();
    const { result } = renderHook(() => useStartCsvImport(), { wrapper });

    await act(async () => {
      await result.current
        .mutateAsync({
          source: 'CSV',
          entityType: 'company',
          rows: [{ Name: 'Acme' }],
          mappings: { Name: 'name' },
          dedupStrategy: 'skip',
        })
        .catch(() => undefined);
    });

    expect(api).toHaveBeenCalledTimes(1);
  });

  it('sends one idempotency key for a start and a new key after it settles', async () => {
    // WHY: two overlapping starts of one click must present the same key, or
    // the server treats them as two imports. A later start is a new action.
    const pending: Array<(value: { id: string }) => void> = [];
    vi.mocked(api).mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push(resolve);
        }),
    );
    const { wrapper } = appClient();
    const { result } = renderHook(() => useStartCsvImport(), { wrapper });
    const input = {
      source: 'CSV' as const,
      entityType: 'company',
      rows: [{ Name: 'Acme' }],
      mappings: { Name: 'name' },
      dedupStrategy: 'skip' as const,
    };

    let first: Promise<unknown> = Promise.resolve();
    let second: Promise<unknown> = Promise.resolve();
    await act(async () => {
      first = result.current.mutateAsync(input);
      second = result.current.mutateAsync(input);
    });

    const keyOf = (call: number) => {
      const options = vi.mocked(api).mock.calls[call]?.[1] as
        | { headers?: Record<string, string> }
        | undefined;
      return options?.headers?.['Idempotency-Key'];
    };

    expect(vi.mocked(api)).toHaveBeenCalledTimes(2);
    expect(keyOf(0)).toMatch(/^import-csv-.{8,}$/);
    expect(keyOf(1)).toBe(keyOf(0));

    await act(async () => {
      pending[0]?.({ id: 'job-1' });
      pending[1]?.({ id: 'job-1' });
      await Promise.all([first, second]);
    });

    vi.mocked(api).mockResolvedValue({ id: 'job-2' });
    await act(async () => {
      await result.current.mutateAsync(input);
    });

    expect(keyOf(2)).toMatch(/^import-csv-.{8,}$/);
    expect(keyOf(2)).not.toBe(keyOf(0));
  });
});

describe('useRetryMigration', () => {
  it('reloads the job when the retry is refused', async () => {
    // WHY: a retry whose rows have expired stores that on the job and returns
    // 409. The wizard only refetched after success, so it kept offering Retry.
    vi.mocked(api).mockRejectedValue(
      new ApiError('Those rows expired. Upload the file again.', 409, null),
    );
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useRetryMigration(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync('job-expired').catch(() => undefined);
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['migrations'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['migrations', 'job-expired'] });
  });
});

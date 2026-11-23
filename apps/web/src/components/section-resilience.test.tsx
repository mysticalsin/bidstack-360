import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { retryQueryOnce } from '@/lib/query-retry';

const apiMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    status: number;
    body: unknown;
    constructor(message: string, status: number, body: unknown) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.body = body;
    }
  }
  return { api: apiMock, ApiError };
});

import { ApiError } from '@/lib/api';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

import { ProductReportsSection } from '@/components/settings/ProductReportsSection';
import { SectionErrorBoundary } from './SectionErrorBoundary';

afterEach(() => {
  cleanup();
  apiMock.mockReset();
});

describe('section resilience', () => {
  it('keeps the shell up when one panel throws, and does not reload the window', () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });

    function Boom(): ReactNode {
      throw new Error('panel exploded');
    }

    render(
      <div>
        <nav>Workspace shell</nav>
        <SectionErrorBoundary>
          <Boom />
        </SectionErrorBoundary>
      </div>,
    );

    // WHY: a broken panel must not take the navigation with it, and must not
    // refresh the whole window the way an app crash does.
    expect(screen.getByText('Workspace shell')).toBeTruthy();
    expect(screen.getByTestId('section-error-fallback')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /this section couldn't load/i })).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('retries a failed report list once, then shows the error while the shell stays', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    apiMock.mockImplementation(() => {
      throw new ApiError('reports down', 503, null);
    });
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: retryQueryOnce, retryDelay: 0 },
      },
    });

    render(
      <div>
        <nav>Workspace shell</nav>
        <QueryClientProvider client={client}>
          <ProductReportsSection />
        </QueryClientProvider>
      </div>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /couldn't load reports/i })).toBeTruthy();
    });

    // WHY: one failed read is retried a single time. After that the panel
    // shows the error. The shell is still there, and the window was not reloaded.
    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Workspace shell')).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

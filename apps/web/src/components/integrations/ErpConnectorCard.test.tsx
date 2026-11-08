import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: mocks.api,
}));

import { ApiError } from '@/lib/api';
import { ErpConnectorCard } from './ErpConnectorCard';

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<ErpConnectorCard />, { wrapper: Wrapper });
}

afterEach(() => {
  cleanup();
  mocks.api.mockReset();
});

describe('ErpConnectorCard', () => {
  it('stays hidden and quiet when this deployment has no ERP routes', async () => {
    mocks.api.mockRejectedValue(new ApiError('Not Found', 404, null));
    const { container } = renderCard();
    await waitFor(() => expect(mocks.api).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(mocks.api.mock.calls.map(([p]) => String(p))).toEqual(['/api/integrations/erp/status']);
    expect(container.textContent).toBe('');
  });
});

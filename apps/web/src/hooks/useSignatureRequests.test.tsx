import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';
import { useSendForSignature, useSignatureRequest, useSignatureRequests } from './useSignatureRequests';

vi.mock('@/lib/api', () => ({
  api: vi.fn(),
}));

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('signature list and detail', () => {
  it('reads /api/v1/signatures/requests, the route the API registers', async () => {
    // WHY: GET /api/signatures normalizes to /api/v1/signatures, which is not
    // a route. The list and the detail live under /api/v1/signatures/requests.
    const { wrapper } = createHarness();
    vi.mocked(api).mockResolvedValue({ items: [], nextCursor: null, total: 0 });
    const list = renderHook(
      () => useSignatureRequests({ status: 'SENT', dateFrom: '2026-01-01', limit: 10 }),
      { wrapper },
    );
    await act(async () => {
      await list.result.current.refetch();
    });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/signatures/requests?status=SENT&dateFrom=2026-01-01&limit=10',
      expect.objectContaining({ signal: expect.anything() }),
    );

    vi.mocked(api).mockResolvedValueOnce({ id: 'sig-1' });
    const one = renderHook(() => useSignatureRequest('sig-1'), { wrapper });
    await act(async () => {
      await one.result.current.refetch();
    });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/signatures/requests/sig-1',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('does not post resend to an unregistered /api/signatures path', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/hooks/useSignatureRequests.ts'), 'utf8');
    expect(source).not.toMatch(/\/api\/signatures\/\$\{[^}]*\}\/resend/);
  });
});

describe('signature void hooks', () => {
  it('does not post to the unregistered /api/signatures/:id/void path', () => {
    // WHY: nothing in the product calls these hooks, and the path they post
    // to is not a registered route. The live void is
    // POST /api/v1/signatures/requests/:id/void.
    const source = readFileSync(resolve(process.cwd(), 'src/hooks/useSignatureRequests.ts'), 'utf8');
    expect(source).not.toMatch(/\/api\/signatures\/\$\{[^}]*\}\/void/);
  });
});

describe('useSendForSignature', () => {
  it('posts to /api/v1/signatures/requests — the only route the API registers', async () => {
    // WHY this matters: the API only registers POST /signatures/requests
    // under the /api/v1 prefix. The old '/api/signatures' path 404'd on every
    // send, making Send for Signature a dead flow.
    const { wrapper } = createHarness();
    vi.mocked(api).mockResolvedValueOnce({ id: 'sig-1' });

    const { result } = renderHook(() => useSendForSignature(), { wrapper });

    const body = {
      documentId: 'doc-1',
      recipients: [{ email: 'a@example.com', name: 'A', role: 'SIGNER' as const }],
      provider: 'DOCUSIGN' as const,
    };
    await act(async () => {
      await result.current.mutateAsync(body);
    });

    expect(api).toHaveBeenCalledWith('/api/v1/signatures/requests', {
      method: 'POST',
      body,
    });
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';
import { useRefreshCompanyTechnicalStack } from './useCompanyTechnicalStack';
import { useUpdateUserRole } from './useUsers';
import {
  useCreateWebhookSubscription,
  useUpdateWebhookSubscription,
} from './useWebhookSubscriptions';

vi.mock('@/lib/api', () => ({
  api: vi.fn(async () => ({
    id: '11111111-1111-4111-8111-111111111111',
    url: 'https://example.com/webhook',
    events: ['opportunity.created'],
    active: true,
    createdAt: '2026-05-18T00:00:00.000Z',
  })),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('admin/integration mutation bodies', () => {
  it('sends user-role updates as objects so the shared API wrapper owns JSON encoding', async () => {
    const { result } = renderHook(() => useUpdateUserRole(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        id: '22222222-2222-4222-8222-222222222222',
        role: 'admin',
      });
    });

    expect(api).toHaveBeenCalledWith('/api/users/22222222-2222-4222-8222-222222222222/role', {
      method: 'PATCH',
      body: { role: 'admin' },
    });
  });

  it('sends webhook create and update bodies as objects for integration reliability', async () => {
    const create = renderHook(() => useCreateWebhookSubscription(), { wrapper });
    const update = renderHook(
      () => useUpdateWebhookSubscription('33333333-3333-4333-8333-333333333333'),
      { wrapper },
    );

    await act(async () => {
      await create.result.current.mutateAsync({
        url: 'https://example.com/webhook',
        events: ['opportunity.created'],
      });
      await update.result.current.mutateAsync({ active: false });
    });

    expect(api).toHaveBeenCalledWith('/api/v1/webhook-subscriptions', {
      method: 'POST',
      body: {
        url: 'https://example.com/webhook',
        events: ['opportunity.created'],
      },
    });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/webhook-subscriptions/33333333-3333-4333-8333-333333333333',
      {
        method: 'PATCH',
        body: { active: false },
      },
    );
  });

  it('sends technical-stack refresh as an empty JSON object so provider pulls are accepted', async () => {
    const { result } = renderHook(() => useRefreshCompanyTechnicalStack('CI Financial'), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(api).toHaveBeenCalledWith('/api/crm/companies/CI%20Financial/technical-stack/refresh', {
      method: 'POST',
      body: {},
    });
  });
});

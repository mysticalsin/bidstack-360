import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';
import { useUpdateLeadById } from './useLeads';
import type { LeadDetail, LeadPage } from '@bidstack/shared';

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

const lead: LeadDetail = {
  id: '11111111-1111-4111-8111-111111111111',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  phone: null,
  companyName: 'Analytical Engines',
  title: 'CTO',
  source: 'website',
  status: 'new',
  score: 40,
  priority: 'medium',
  ownerId: null,
  ownerName: null,
  convertedToOpportunityId: null,
  statusChangedAt: '2026-06-03T12:00:00.000Z',
  createdAt: '2026-06-03T12:00:00.000Z',
  updatedAt: '2026-06-03T12:00:00.000Z',
  notes: null,
  budget: null,
  authority: null,
  need: null,
  timeline: null,
  intel: null,
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('useUpdateLeadById', () => {
  it('updates lead list/detail caches without treating detail caches as lead pages', async () => {
    const { queryClient, wrapper } = createHarness();
    const listKey = ['leads', { limit: 25 }] as const;
    const detailKey = ['leads', lead.id] as const;

    queryClient.setQueryData<LeadPage>(listKey, {
      items: [lead],
      nextCursor: null,
    });
    queryClient.setQueryData<LeadDetail>(detailKey, lead);
    vi.mocked(api).mockResolvedValueOnce({ ...lead, status: 'qualified' });

    const { result } = renderHook(() => useUpdateLeadById(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        id: lead.id,
        patch: { status: 'qualified' },
      });
    });

    expect(queryClient.getQueryData<LeadPage>(listKey)?.items[0]?.status).toBe('qualified');
    expect(queryClient.getQueryData<LeadDetail>(detailKey)?.status).toBe('qualified');
  });
});

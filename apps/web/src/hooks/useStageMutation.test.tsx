import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';
import { useStageMutation } from './useStageMutation';
import type { Opportunity, OpportunityPage, PipelineStage } from '@bidstack/shared';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

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

const initialStage: PipelineStage = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Qualification',
  probability: 20,
  color: '#3b82f6',
  isWon: false,
  isLost: false,
};

const targetStage: PipelineStage = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Proposal Sent',
  probability: 45,
  color: '#06b6d4',
  isWon: false,
  isLost: false,
};

const opportunity: Opportunity = {
  id: '33333333-3333-4333-8333-333333333333',
  code: 'OP-1234',
  customer: 'Acme Corp',
  name: 'Enterprise CRM rollout',
  stage: 's1_lead',
  pipelineStageId: initialStage.id,
  pipelineStage: initialStage,
  value: 250_000,
  probability: 20,
  dueDate: null,
  owner: null,
  industry: 'technology',
  logo: null,
  country: 'US',
  territoryId: null,
  territoryName: null,
  updatedAt: '2026-06-02T12:00:00.000Z',
  taskCount: 0,
  commentCount: 0,
  viewCount: 0,
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('useStageMutation', () => {
  it('moves cards optimistically without treating count caches as opportunity pages', async () => {
    const { queryClient, wrapper } = createHarness();
    const listKey = ['opportunities', { limit: 50 }] as const;
    const countKey = ['opportunities', 'count', { excludeClosed: true }] as const;

    queryClient.setQueryData<OpportunityPage>(listKey, {
      items: [opportunity],
      nextCursor: null,
    });
    queryClient.setQueryData(countKey, { count: 1 });
    vi.mocked(api).mockResolvedValueOnce({
      id: opportunity.id,
      pipelineStageId: targetStage.id,
      stage: 's2_sent',
      pipelineStage: targetStage,
    });

    const { result } = renderHook(() => useStageMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        id: opportunity.id,
        pipelineStageId: targetStage.id,
        pipelineStage: targetStage,
      });
    });

    expect(api).toHaveBeenCalledWith(`/api/opportunities/${opportunity.id}/stage`, {
      method: 'POST',
      body: { pipelineStageId: targetStage.id },
    });
    expect(queryClient.getQueryData(countKey)).toEqual({ count: 1 });

    const page = queryClient.getQueryData<OpportunityPage>(listKey);
    expect(page?.items[0]).toMatchObject({
      id: opportunity.id,
      stage: 's2_sent',
      pipelineStageId: targetStage.id,
      pipelineStage: targetStage,
    });
  });

  it('keeps optimistic UUID moves stage-coherent before the server confirms', async () => {
    const { queryClient, wrapper } = createHarness();
    const listKey = ['opportunities', { limit: 50 }] as const;

    queryClient.setQueryData<OpportunityPage>(listKey, {
      items: [opportunity],
      nextCursor: null,
    });
    let confirmMove: ((value: unknown) => void) | undefined;
    vi.mocked(api).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          confirmMove = resolve;
        }),
    );

    const { result } = renderHook(() => useStageMutation(), { wrapper });

    act(() => {
      result.current.mutate({
        id: opportunity.id,
        pipelineStageId: targetStage.id,
        pipelineStage: targetStage,
      });
    });

    await waitFor(() => {
      const optimistic = queryClient.getQueryData<OpportunityPage>(listKey);
      expect(optimistic?.items[0]).toMatchObject({
        id: opportunity.id,
        stage: targetStage.name,
        pipelineStageId: targetStage.id,
        pipelineStage: targetStage,
      });
    });

    act(() => {
      confirmMove?.({
        id: opportunity.id,
        pipelineStageId: targetStage.id,
        stage: 's2_sent',
        pipelineStage: targetStage,
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('rolls back list and detail caches when the server rejects a stage move', async () => {
    const { queryClient, wrapper } = createHarness();
    const listKey = ['opportunities', { limit: 50 }] as const;
    const detailKey = ['opportunity', opportunity.id] as const;
    const countKey = ['opportunities', 'count', { excludeClosed: true }] as const;

    queryClient.setQueryData<OpportunityPage>(listKey, {
      items: [opportunity],
      nextCursor: null,
    });
    queryClient.setQueryData<Opportunity>(detailKey, opportunity);
    queryClient.setQueryData(countKey, { count: 1 });
    vi.mocked(api).mockRejectedValueOnce(new Error('Stage is locked'));

    const { result } = renderHook(() => useStageMutation(), { wrapper });

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          id: opportunity.id,
          pipelineStageId: targetStage.id,
          pipelineStage: targetStage,
        });
      }),
    ).rejects.toThrow('Stage is locked');

    expect(queryClient.getQueryData<OpportunityPage>(listKey)?.items[0]).toEqual(opportunity);
    expect(queryClient.getQueryData<Opportunity>(detailKey)).toEqual(opportunity);
    expect(queryClient.getQueryData(countKey)).toEqual({ count: 1 });
  });
});

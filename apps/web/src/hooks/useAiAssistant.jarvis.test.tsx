// A confirmed Jarvis write must refresh the record the user is looking at,
// not only the task lists: confirming opportunity.update on its detail page
// used to leave the old stage on screen while the card said "Applied".
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';
import { useJarvisActionDecision } from './useAiAssistant';

vi.mock('@/lib/api', async (importOriginal) => ({ ...(await importOriginal<object>()), api: vi.fn() }));

const OPP = '11111111-1111-4111-8111-111111111111';
const PROPOSAL = '22222222-2222-4222-8222-222222222222';

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useJarvisActionDecision(), { wrapper });
  const keys = () => invalidate.mock.calls.map(([filters]) => filters?.queryKey);
  return { result, keys };
}

describe('useJarvisActionDecision invalidation', () => {
  beforeEach(() => vi.mocked(api).mockReset());

  it('refreshes the opportunity detail and lists after a confirmed opportunity.update', async () => {
    vi.mocked(api).mockResolvedValue({ ok: true, tool: 'opportunity.update', result: { id: OPP } });
    const { result, keys } = setup();
    await result.current.mutateAsync({ actionId: 'a1', decision: 'confirm' });
    expect(keys()).toEqual(expect.arrayContaining([['opportunity', OPP], ['opportunities']]));
  });

  it('refreshes the proposal after a confirmed section draft', async () => {
    vi.mocked(api).mockResolvedValue({
      ok: true,
      tool: 'proposal.section_draft',
      result: { id: 's1', proposalId: PROPOSAL },
    });
    const { result, keys } = setup();
    await result.current.mutateAsync({ actionId: 'a2', decision: 'confirm' });
    expect(keys()).toEqual(expect.arrayContaining([['proposal', PROPOSAL], ['proposals']]));
  });

  it('keeps refreshing tasks after a confirmed task and nothing after a cancel', async () => {
    vi.mocked(api).mockResolvedValue({ ok: true, tool: 'tasks.create', result: { id: 't1' } });
    const confirmed = setup();
    await confirmed.result.current.mutateAsync({ actionId: 'a3', decision: 'confirm' });
    expect(confirmed.keys()).toEqual([['tasks']]);

    vi.mocked(api).mockResolvedValue({ ok: true });
    const cancelled = setup();
    await cancelled.result.current.mutateAsync({ actionId: 'a4', decision: 'cancel' });
    expect(cancelled.keys()).toEqual([]);
  });
});

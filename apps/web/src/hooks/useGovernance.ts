import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import type {
  GovernanceActionInput,
  GovernanceActionPatch,
  GovernanceMeeting,
  GovernanceMeetingCreate,
  GovernanceMeetingList,
} from '@bidstack/shared';

export function useGovernanceMeetings(accountKey: string) {
  return useQuery({
    queryKey: ['governance-meetings', accountKey],
    queryFn: ({ signal }) =>
      api<GovernanceMeetingList>(
        `/api/governance-meetings?accountKey=${encodeURIComponent(accountKey)}`,
        { signal },
      ),
    enabled: accountKey.length > 0,
  });
}

export function useCreateGovernanceMeeting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: GovernanceMeetingCreate) =>
      api<GovernanceMeeting>('/api/governance-meetings', { method: 'POST', body }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['governance-meetings'] }),
  });
}

export function useAddGovernanceAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ meetingId, body }: { meetingId: string; body: GovernanceActionInput }) =>
      api<GovernanceMeeting>(`/api/governance-meetings/${meetingId}/actions`, {
        method: 'POST',
        body,
      }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['governance-meetings'] }),
  });
}

export function usePatchGovernanceAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      meetingId,
      actionId,
      body,
    }: {
      meetingId: string;
      actionId: string;
      body: GovernanceActionPatch;
    }) =>
      api<GovernanceMeeting>(`/api/governance-meetings/${meetingId}/actions/${actionId}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['governance-meetings'] }),
    // GovernanceLogCard's status-advance button wires no onError — a rejected
    // mutation left the "Advance status" pill just stop showing pending state.
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Could not update governance action'),
  });
}

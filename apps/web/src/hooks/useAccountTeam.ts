import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AccountFollowAction,
  AccountFollowState,
  AccountTeam,
  AccountTeamMember,
  AccountTeamMemberCreate,
  AccountTeamMemberPatch,
  UserAllocation,
} from '@bidstack/shared';

import { api } from '@/lib/api';
import { toast } from '@/components/ui/Toast';

const teamKey = (companyId: string) => ['account-team', companyId] as const;
const followKey = (companyId: string) => ['account-follow', companyId] as const;

export function useAccountTeam(companyId: string | undefined) {
  return useQuery({
    queryKey: teamKey(companyId ?? ''),
    queryFn: ({ signal }) => api<AccountTeam>(`/api/companies/${companyId}/team`, { signal }),
    enabled: !!companyId,
    staleTime: 30_000,
  });
}

/** One person's allocation across every account; drives the over-100% warning. */
export function useUserAllocation(userId: string | undefined) {
  return useQuery({
    queryKey: ['account-allocation', userId ?? ''],
    queryFn: ({ signal }) =>
      api<UserAllocation>(`/api/companies/allocations/${userId}`, { signal }),
    enabled: !!userId,
    staleTime: 15_000,
  });
}

function useTeamInvalidate(companyId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: teamKey(companyId) });
    void qc.invalidateQueries({ queryKey: ['account-allocation'] });
    void qc.invalidateQueries({ queryKey: followKey(companyId) });
  };
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export function useAddTeamMember(companyId: string) {
  const invalidate = useTeamInvalidate(companyId);
  return useMutation({
    mutationFn: (body: AccountTeamMemberCreate) =>
      api<AccountTeamMember>(`/api/companies/${companyId}/team`, { method: 'POST', body }),
    onSuccess: () => {
      invalidate();
      toast.success('Added to the account team');
    },
    onError: (err) => toast.error(errorText(err, 'Could not add the team member')),
  });
}

export function useUpdateTeamMember(companyId: string) {
  const invalidate = useTeamInvalidate(companyId);
  return useMutation({
    mutationFn: ({ memberId, patch }: { memberId: string; patch: AccountTeamMemberPatch }) =>
      api<AccountTeamMember>(`/api/companies/${companyId}/team/${memberId}`, {
        method: 'PATCH',
        body: patch,
      }),
    onSuccess: () => {
      invalidate();
      toast.success('Team member updated');
    },
    onError: (err) => toast.error(errorText(err, 'Could not update the team member')),
  });
}

export function useRemoveTeamMember(companyId: string) {
  const invalidate = useTeamInvalidate(companyId);
  return useMutation({
    mutationFn: (memberId: string) =>
      api<null>(`/api/companies/${companyId}/team/${memberId}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidate();
      toast.success('Removed from the account team');
    },
    onError: (err) => toast.error(errorText(err, 'Could not remove the team member')),
  });
}

export function useAccountFollow(companyId: string | undefined) {
  return useQuery({
    queryKey: followKey(companyId ?? ''),
    queryFn: ({ signal }) =>
      api<AccountFollowState>(`/api/companies/${companyId}/follow`, { signal }),
    enabled: !!companyId,
    staleTime: 30_000,
  });
}

export function useSetAccountFollow(companyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (action: AccountFollowAction['action']) =>
      api<AccountFollowState>(`/api/companies/${companyId}/follow`, {
        method: 'PUT',
        body: { action },
      }),
    onSuccess: (data) => qc.setQueryData(followKey(companyId), data),
    onError: (err) => toast.error(errorText(err, 'Could not change follow settings')),
  });
}

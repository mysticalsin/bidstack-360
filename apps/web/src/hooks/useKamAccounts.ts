import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import type {
  KamAccount,
  KamAccountCandidateList,
  KamAccountDesignatePatch,
  KamAccountList,
} from '@bidstack/shared';

const KAM = '/api/kam';

/** Designated key accounts (the switcher source). */
export function useKamAccounts() {
  return useQuery({
    queryKey: ['kam-accounts'],
    queryFn: ({ signal }) => api<KamAccountList>(`${KAM}/accounts`, { signal }),
    // Live: the cockpit must reflect current key accounts on every visit, not
    // the app's 2-min persisted cache (e.g. a just-designated account).
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

/** Typeahead of NOT-yet-key-account companies (designate dialog). */
export function useKamCandidates(q: string) {
  const query = q.trim();
  return useQuery({
    queryKey: ['kam-account-candidates', query],
    enabled: query.length >= 2,
    queryFn: ({ signal }) =>
      api<KamAccountCandidateList>(`${KAM}/accounts/candidates?q=${encodeURIComponent(query)}`, { signal }),
  });
}

export function useDesignateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ companyId, patch }: { companyId: string; patch: KamAccountDesignatePatch }) =>
      api<KamAccount>(`${KAM}/accounts/${companyId}`, { method: 'PATCH', body: patch }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['kam-accounts'] });
      void qc.invalidateQueries({ queryKey: ['kam-account-candidates'] });
      void qc.invalidateQueries({ queryKey: ['kam-account-kpi'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not update the account'),
  });
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import type {
  KamHandoffConfirmBody as KamHandoffConfirmBodySchema,
  KamHandoffDetail as KamHandoffDetailSchema,
  KamHandoffExportResult as KamHandoffExportResultSchema,
  KamHandoffList as KamHandoffListSchema,
  KamHandoffPayload as KamHandoffPayloadSchema,
} from '@bidstack/shared';
import type {
  KamAccountKpi,
  KamAccountTodos,
  KamDraftApproveResult,
  KamInitiativeDetail,
  KamInitiativeList,
  KamInitiativeTransitionBody,
  KamSessionDraftDetail,
  KamSessionDraftList,
} from '@bidstack/shared';
import type { z } from 'zod';

const KAM = '/api/kam';

export type KamHandoffConfirmBodyDto = z.infer<typeof KamHandoffConfirmBodySchema>;
export type KamHandoffDetailDto = z.infer<typeof KamHandoffDetailSchema>;
export type KamHandoffExportResultDto = z.infer<typeof KamHandoffExportResultSchema>;
export type KamHandoffListDto = z.infer<typeof KamHandoffListSchema>;
export type KamHandoffPayloadDto = z.infer<typeof KamHandoffPayloadSchema>;

// The cockpit is an operational surface — its read queues (initiatives, the
// human-gate drafts fed by external Dust agents, to-dos, KPIs) must reflect
// current server state on every visit, NOT the app's 2-min persisted cache.
const LIVE = { staleTime: 0, refetchOnMount: 'always' } as const;

// ─── Initiatives + state machine ──────────────────────────────────────────
export function useKamInitiatives(companyId: string | undefined) {
  return useQuery({
    queryKey: ['kam-initiatives', companyId],
    enabled: Boolean(companyId),
    ...LIVE,
    queryFn: ({ signal }) =>
      api<KamInitiativeList>(`${KAM}/initiatives?companyId=${companyId}`, { signal }),
  });
}

export function useTransitionInitiative(companyId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: KamInitiativeTransitionBody }) =>
      api<KamInitiativeDetail>(`${KAM}/initiatives/${id}/transition`, { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['kam-initiatives', companyId] });
      void qc.invalidateQueries({ queryKey: ['kam-account-kpi', companyId] });
      void qc.invalidateQueries({ queryKey: ['kam-todos', companyId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Transition failed'),
  });
}

// ─── Per-account to-do + KPIs ───────────────────────────────────────────────
export function useKamAccountTodos(companyId: string | undefined) {
  return useQuery({
    queryKey: ['kam-todos', companyId],
    enabled: Boolean(companyId),
    ...LIVE,
    queryFn: ({ signal }) => api<KamAccountTodos>(`${KAM}/accounts/${companyId}/todos`, { signal }),
  });
}

export function useKamAccountKpi(companyId: string | undefined) {
  return useQuery({
    queryKey: ['kam-account-kpi', companyId],
    enabled: Boolean(companyId),
    ...LIVE,
    queryFn: ({ signal }) => api<KamAccountKpi>(`${KAM}/reports/account/${companyId}`, { signal }),
  });
}

// ─── Human-gate drafts ───────────────────────────────────────────────────────
export function useKamDrafts(
  companyId: string | undefined,
  status?: 'pending' | 'approved' | 'rejected',
) {
  return useQuery({
    queryKey: ['kam-drafts', companyId, status],
    enabled: Boolean(companyId),
    ...LIVE,
    queryFn: ({ signal }) => {
      const qs = new URLSearchParams({ companyId: companyId! });
      if (status) qs.set('status', status);
      return api<KamSessionDraftList>(`${KAM}/drafts?${qs.toString()}`, { signal });
    },
  });
}

function useDraftDecision(companyId: string | undefined, decision: 'approve' | 'reject') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<KamDraftApproveResult | KamSessionDraftDetail>(`${KAM}/drafts/${id}/${decision}`, {
        method: 'POST',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['kam-drafts', companyId] });
      void qc.invalidateQueries({ queryKey: ['kam-initiatives', companyId] });
      void qc.invalidateQueries({ queryKey: ['kam-todos', companyId] });
      void qc.invalidateQueries({ queryKey: ['kam-account-kpi', companyId] });
      toast.success(
        decision === 'approve' ? 'Draft approved — committed to the account' : 'Draft rejected',
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : `Could not ${decision} draft`),
  });
}

export const useApproveDraft = (companyId: string | undefined) =>
  useDraftDecision(companyId, 'approve');
export const useRejectDraft = (companyId: string | undefined) =>
  useDraftDecision(companyId, 'reject');

// ABC OM handoffs
export function useKamHandoffs(companyId: string | undefined) {
  return useQuery({
    queryKey: ['kam-handoffs', companyId],
    enabled: Boolean(companyId),
    ...LIVE,
    queryFn: ({ signal }) =>
      api<KamHandoffListDto>(`${KAM}/handoffs?companyId=${companyId}`, { signal }),
  });
}

export function useExportKamHandoff(companyId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<KamHandoffExportResultDto>(`${KAM}/handoffs/${id}/export`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['kam-handoffs', companyId] });
      toast.success('Handoff export ready');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not export handoff'),
  });
}

export function useConfirmKamHandoff(companyId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: KamHandoffConfirmBodyDto }) =>
      api<KamHandoffDetailDto>(`${KAM}/handoffs/${id}/confirm`, { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['kam-handoffs', companyId] });
      toast.success('Handoff confirmed in OM');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not confirm handoff'),
  });
}

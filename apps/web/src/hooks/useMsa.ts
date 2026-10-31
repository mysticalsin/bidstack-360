import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { msaClient, uploadMsaVersion, type UploadStage } from '@/lib/msa/client';
import type { MsaCreate, MsaListQuery, MsaSummaryRow } from '@/lib/msa/types';

export function useMsaList(q: MsaListQuery) {
  return useQuery({ queryKey: ['msa', 'list', q], queryFn: ({ signal }) => msaClient.list(q, signal) });
}

export function useMsaDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['msa', 'detail', id],
    queryFn: ({ signal }) => msaClient.detail(id!, signal),
    enabled: Boolean(id),
    retry: (n, err) => n < 2 && !(err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 404),
  });
}

export function useMsaTimeline(id: string | undefined) {
  return useQuery({ queryKey: ['msa', 'timeline', id], queryFn: ({ signal }) => msaClient.timeline(id!, signal), enabled: Boolean(id) });
}

export function useMsaAccountSummary(companyId: string | undefined, companyName?: string) {
  return useQuery({
    queryKey: ['msa', 'summary', companyId],
    queryFn: ({ signal }) => msaClient.accountSummary(companyId!, companyName, signal),
    enabled: Boolean(companyId),
  });
}

/** Each call is audited server-side, so fetch once per version and keep it until it expires. */
export function useMsaDownloadUrl(id: string | undefined, versionId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['msa', 'download', id, versionId],
    queryFn: () => msaClient.downloadUrl(id!, versionId!),
    enabled: Boolean(id && versionId && enabled),
    staleTime: 4 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export function useCreateMsa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MsaCreate) => api<MsaSummaryRow>('/api/msa', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['msa'] }),
  });
}

export function useUploadMsaVersion(onStage?: (s: UploadStage) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, file, note }: { id: string; file: File; note: string | null }) => uploadMsaVersion(id, file, note, onStage),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['msa'] }),
  });
}

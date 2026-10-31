import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { msaClient, uploadMsaVersion, type UploadStage } from '@/lib/msa/client';
import type { MsaCreate, MsaListQuery, MsaSearchResponse, MsaSummaryRow } from '@/lib/msa/types';

export function useMsaList(q: MsaListQuery) {
  return useQuery({ queryKey: ['msa', 'list', q], queryFn: ({ signal }) => msaClient.list(q, signal) });
}

/** Full-text search inside uploaded files. Off for Sample data and for queries under 2 characters. */
export function useMsaSearch(q: string, opts: { companyId?: string; enabled: boolean }) {
  const term = q.trim();
  const qs = new URLSearchParams({ q: term, limit: '20' });
  if (opts.companyId) qs.set('companyId', opts.companyId);
  return useQuery({
    queryKey: ['msa', 'search', term, opts.companyId ?? null],
    queryFn: ({ signal }) => api<MsaSearchResponse>(`/api/msa/search?${qs.toString()}`, { signal }),
    enabled: opts.enabled && term.length >= 2 && term.length <= 200,
    staleTime: 30_000,
  });
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
    staleTime: 100_000, // signed links live 120 s
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

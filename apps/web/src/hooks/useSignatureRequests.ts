/**
 * React Query hooks for Signature Requests.
 *
 * WHY: Keeps all signature-related mutations in one place so the list page,
 * detail page, and action modal all share the same cache keys and auto-update
 * when any mutation resolves.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type {
  SignatureRequest,
  SignatureRequestPage,
  SignatureRequestCreate,
  SignatureRequestFilter,
  SignatureRequestVoid,
  PublicSignatureRequest,
  InternalSignSubmit,
} from '@bidstack/shared';

const SIG_KEY = 'signature-requests';

// ─── List ─────────────────────────────────────────────────────────────────────

export function useSignatureRequests(filter: Partial<SignatureRequestFilter> = {}) {
  return useQuery<SignatureRequestPage>({
    queryKey: [SIG_KEY, filter],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      if (filter.status) params.set('status', filter.status);
      if (filter.recipientEmail) params.set('recipientEmail', filter.recipientEmail);
      if (filter.dateFrom) params.set('dateFrom', filter.dateFrom);
      if (filter.dateTo) params.set('dateTo', filter.dateTo);
      if (filter.cursor) params.set('cursor', filter.cursor);
      if (filter.limit) params.set('limit', String(filter.limit));
      const qs = params.toString();
      return api<SignatureRequestPage>(`/api/signatures${qs ? `?${qs}` : ''}`, { signal });
    },
  });
}

// ─── Single ───────────────────────────────────────────────────────────────────

export function useSignatureRequest(id: string) {
  return useQuery<SignatureRequest>({
    queryKey: [SIG_KEY, id],
    queryFn: ({ signal }) => api<SignatureRequest>(`/api/signatures/${id}`, { signal }),
    enabled: Boolean(id),
  });
}

// ─── Send (create) ────────────────────────────────────────────────────────────

export function useSendForSignature() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SignatureRequestCreate) =>
      api<SignatureRequest>('/api/signatures', { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [SIG_KEY] });
    },
  });
}

// ─── Void ─────────────────────────────────────────────────────────────────────

export function useVoidSignature(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SignatureRequestVoid) =>
      api<SignatureRequest>(`/api/signatures/${id}/void`, { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [SIG_KEY, id] });
      qc.invalidateQueries({ queryKey: [SIG_KEY] });
    },
  });
}

// ─── Resend ───────────────────────────────────────────────────────────────────

export function useResendSignature(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<SignatureRequest>(`/api/signatures/${id}/resend`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [SIG_KEY, id] });
    },
  });
}

// ─── Bulk void ────────────────────────────────────────────────────────────────

export function useBulkVoidSignatures() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, reason }: { ids: string[]; reason: string }) =>
      Promise.all(
        ids.map((id) =>
          api<SignatureRequest>(`/api/signatures/${id}/void`, {
            method: 'POST',
            body: { reason },
          }),
        ),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [SIG_KEY] });
    },
  });
}

// ─── Public (no auth) ────────────────────────────────────────────────────────

export function usePublicSignatureRequest(token: string) {
  return useQuery<PublicSignatureRequest>({
    queryKey: ['public-sign', token],
    queryFn: ({ signal }) =>
      api<PublicSignatureRequest>(`/api/sign/${token}`, { signal }),
    enabled: Boolean(token),
    // Don't retry on 404 / 410 — invalid/expired tokens should fail fast
    retry: (count, err) => {
      if (err instanceof Error && 'status' in err) {
        const status = (err as { status: number }).status;
        if (status === 404 || status === 410 || status === 400) return false;
      }
      return count < 2;
    },
  });
}

export function useSubmitSignature(token: string) {
  return useMutation({
    mutationFn: (body: InternalSignSubmit) =>
      api<{ downloadUrl?: string }>(`/api/sign/${token}`, { method: 'POST', body }),
  });
}

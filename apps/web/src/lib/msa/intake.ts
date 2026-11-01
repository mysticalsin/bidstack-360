import { api, buildApiUrl, getAuthToken } from '@/lib/api';
import type {
  MsaIntakeConfirm,
  MsaIntakeConfirmResponse,
  MsaIntakeDraft,
  MsaIntakeUploadUrlResponse,
  MsaLeverageFlag,
  MsaLeverageListResponse,
  MsaLeverageSummary,
  MsaValuePanel,
  SigningEntity,
  SigningEntityListResponse,
  SigningEntityWrite,
} from '@bidstack/shared';

import { isOwnApiUrl, validateMsaFile, type UploadStage } from './client';

export async function uploadMsaIntake(
  file: File,
  onStage: (s: UploadStage) => void = () => undefined,
): Promise<MsaIntakeDraft> {
  onStage('validating');
  const v = validateMsaFile(file);
  if ('error' in v) throw new Error(v.error);
  const meta = { fileName: file.name, contentType: v.contentType, bytes: file.size };
  onStage('requesting');
  const up = await api<MsaIntakeUploadUrlResponse>('/api/msa/intake/upload-url', { method: 'POST', body: meta });
  onStage('uploading');
  const own = isOwnApiUrl(up.uploadUrl);
  const token = own ? await getAuthToken() : null;
  const res = await fetch(up.uploadUrl.startsWith('/') ? buildApiUrl(up.uploadUrl) : up.uploadUrl, {
    method: 'PUT',
    headers: { ...up.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: file,
    ...(own ? { credentials: 'include' as const } : {}),
  });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  onStage('finalizing');
  const draft = await api<MsaIntakeDraft>('/api/msa/intake', {
    method: 'POST',
    body: { ...meta, storageKey: up.storageKey, draftId: up.draftId },
  });
  onStage('done');
  return draft;
}

export function fetchIntakeDraft(id: string, signal?: AbortSignal) {
  return api<MsaIntakeDraft>(`/api/msa/intake/${id}`, { signal });
}

export function confirmIntake(id: string, body: MsaIntakeConfirm) {
  return api<MsaIntakeConfirmResponse>(`/api/msa/intake/${id}/confirm`, { method: 'POST', body });
}

export function fetchLeverage(companyId?: string, signal?: AbortSignal) {
  const qs = companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
  return api<MsaLeverageListResponse>(`/api/msa/leverage${qs}`, { signal });
}

export function fetchLeverageSummary(signal?: AbortSignal) {
  return api<MsaLeverageSummary>('/api/msa/leverage/summary', { signal });
}

export function fetchMsaLeverage(id: string, signal?: AbortSignal) {
  return api<{ flag: MsaLeverageFlag | null }>(`/api/msa/${id}/leverage`, { signal });
}

export function fetchValuePanel(id: string, signal?: AbortSignal) {
  return api<MsaValuePanel>(`/api/msa/${id}/value-panel`, { signal });
}

export function fetchSigningEntities(signal?: AbortSignal) {
  return api<SigningEntityListResponse>('/api/settings/signing-entities', { signal });
}

export function createSigningEntity(body: SigningEntityWrite) {
  return api<SigningEntity>('/api/settings/signing-entities', { method: 'POST', body });
}

export function patchSigningEntity(id: string, body: Partial<SigningEntityWrite>) {
  return api<SigningEntity>(`/api/settings/signing-entities/${id}`, { method: 'PATCH', body });
}

// MSA API client with a labelled Sample fallback. The fallback triggers only
// when the server has no /msa routes at all (Fastify "Route … not found" 404),
// never for a real 404 on a record, a 403 or a 5xx.
import { ApiError, api, buildApiUrl, getAuthToken } from '@/lib/api';

import { sampleDetail, sampleList, sampleSummary, sampleTimeline } from './sample';
import {
  MSA_ALLOWED_CONTENT_TYPES, MSA_MAX_BYTES,
  type MsaAccountSummary, type MsaContentType, type MsaDetail, type MsaDownloadUrlResponse, type MsaListQuery,
  type MsaListResponse, type MsaTimelineEvent, type MsaTimelineResponse, type MsaUploadUrlResponse,
} from './types';

export interface Sampled<T> { data: T; sample: boolean }

export function isMissingRoute(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status !== 404) return false;
  const body = err.body as { message?: unknown } | null;
  const msg = typeof body?.message === 'string' ? body.message : err.message;
  return /^Route \S+ not found/i.test(msg);
}

async function orSample<T>(live: () => Promise<T>, sample: () => T): Promise<Sampled<T>> {
  try {
    return { data: await live(), sample: false };
  } catch (err) {
    if (isMissingRoute(err)) return { data: sample(), sample: true };
    throw err;
  }
}

export function listQueryString(q: MsaListQuery): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v == null || v === '') continue;
    if (Array.isArray(v)) v.forEach((x) => p.append(k, String(x)));
    else p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const msaClient = {
  list: (q: MsaListQuery, signal?: AbortSignal) =>
    orSample(() => api<MsaListResponse>(`/api/msa${listQueryString(q)}`, { signal }), () => sampleList(q)),
  detail: (id: string, signal?: AbortSignal) =>
    orSample(() => api<MsaDetail>(`/api/msa/${id}`, { signal }), () => {
      const d = sampleDetail(id);
      if (!d) throw new ApiError('Agreement not found', 404, null);
      return d;
    }),
  timeline: (id: string, signal?: AbortSignal) =>
    orSample(
      async () => (await api<MsaTimelineResponse>(`/api/msa/${id}/timeline`, { signal })).items,
      (): MsaTimelineEvent[] => sampleTimeline(id),
    ),
  accountSummary: (companyId: string, companyName?: string, signal?: AbortSignal) =>
    orSample(
      () => api<MsaAccountSummary>(`/api/msa/accounts/${companyId}/summary`, { signal }),
      () => sampleSummary(companyId, companyName),
    ),
  downloadUrl: (id: string, versionId: string) =>
    api<MsaDownloadUrlResponse>(`/api/msa/${id}/versions/${versionId}/download-url`),
};

export type UploadStage = 'validating' | 'requesting' | 'uploading' | 'finalizing' | 'done';

/** Client-side guard; the API re-checks size, type and magic bytes. */
export function validateMsaFile(file: { name: string; size: number; type: string }): { contentType: MsaContentType } | { error: string } {
  const byExt = /\.pdf$/i.test(file.name) ? 'application/pdf' : /\.docx$/i.test(file.name) ? MSA_ALLOWED_CONTENT_TYPES[1] : null;
  const contentType = (MSA_ALLOWED_CONTENT_TYPES as readonly string[]).includes(file.type) ? (file.type as MsaContentType) : byExt;
  if (!contentType) return { error: 'Only PDF and Word (.docx) files can be added.' };
  if (file.size <= 0) return { error: 'This file is empty.' };
  if (file.size > MSA_MAX_BYTES) return { error: 'Files must be 25 MB or smaller.' };
  return { contentType };
}

/** True for a relative path or a URL on the API's own origin (local storage driver). */
export function isOwnApiUrl(url: string, origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'): boolean {
  if (url.startsWith('/')) return true;
  try {
    const target = new URL(url);
    const api = new URL(buildApiUrl('/api/v1'), origin);
    return target.origin === api.origin || target.pathname.startsWith('/api/files/local-upload');
  } catch {
    return false;
  }
}

/** upload-url → PUT bytes → finalize. Reports each stage for the progress UI. */
export async function uploadMsaVersion(
  id: string,
  file: File,
  note: string | null,
  onStage: (s: UploadStage) => void = () => undefined,
): Promise<{ id: string; versionNo: number; sha256: string }> {
  onStage('validating');
  const v = validateMsaFile(file);
  if ('error' in v) throw new Error(v.error);
  const meta = { fileName: file.name, contentType: v.contentType, bytes: file.size };
  onStage('requesting');
  const up = await api<MsaUploadUrlResponse>(`/api/msa/${id}/versions/upload-url`, { method: 'POST', body: meta });
  onStage('uploading');
  // Local-driver URLs point back at our own API (/api/files/local-upload) and
  // need the session; presigned S3 URLs carry their own signature and must
  // not get our auth header.
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
  const out = await api<{ id: string; versionNo: number; sha256: string }>(`/api/msa/${id}/versions`, {
    method: 'POST',
    body: { ...meta, storageKey: up.storageKey, note },
  });
  onStage('done');
  return out;
}

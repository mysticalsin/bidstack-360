// File attachment hooks. Wraps the 3-step upload flow:
//   1. POST /api/files/upload-url  → server signs a PUT URL
//   2. PUT  <uploadUrl>             → bytes go straight to storage
//   3. POST /api/files/finalize     → server writes the DB row
//
// Why a single hook instead of three: components shouldn't have to know the
// flow. They call `upload(file)` and listen for invalidation.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type {
  FileAttachment,
  FileFinalizeRequest,
  FileListResponse,
  FileUploadUrlRequest,
  FileUploadUrlResponse,
} from '@bidstack/shared';

const KEY = (accountId: string) => ['files', accountId];

export function useFiles(accountId: string | null | undefined) {
  return useQuery({
    queryKey: KEY(accountId ?? ''),
    queryFn: ({ signal }) =>
      api<FileListResponse>(`/api/files?accountId=${encodeURIComponent(accountId ?? '')}`, {
        signal,
      }),
    enabled: !!accountId,
  });
}

interface UploadVars {
  accountId: string;
  file: File;
}

async function performUpload({ accountId, file }: UploadVars): Promise<FileAttachment> {
  const presignReq: FileUploadUrlRequest = {
    accountId,
    name: file.name,
    contentType: file.type as FileUploadUrlRequest['contentType'],
    bytes: file.size,
  };
  const presigned = await api<FileUploadUrlResponse>('/api/files/upload-url', {
    method: 'POST',
    body: presignReq,
  });

  // Why direct fetch (not api()): api() always JSON-encodes the body and sets
  // Content-Type to application/json. The signed URL expects the raw file
  // bytes with the exact Content-Type the server signed.
  const putRes = await fetch(presigned.uploadUrl, {
    method: 'PUT',
    headers: presigned.headers,
    body: file,
    credentials: 'include',
  });
  if (!putRes.ok) {
    throw new Error(`Upload failed (${putRes.status})`);
  }

  const finalizeReq: FileFinalizeRequest = {
    accountId,
    storageKey: presigned.storageKey,
    name: file.name,
    contentType: file.type as FileFinalizeRequest['contentType'],
    bytes: file.size,
  };
  return api<FileAttachment>('/api/files/finalize', {
    method: 'POST',
    body: finalizeReq,
  });
}

export function useUploadFile(accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => performUpload({ accountId, file }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY(accountId) }),
  });
}

export function useDeleteFile(accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/files/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY(accountId) }),
  });
}

export function downloadFileUrl(id: string): string {
  // Why a function and not a hook: anchors / window.location calls don't need
  // React lifecycle. Centralized so we can swap to streaming in one place.
  return `/api/files/${id}/download`;
}

/**
 * RFP document upload → pipeline start.
 *
 * The RFP upload route (POST /opportunities/:id/rfp/upload) does NOT accept raw
 * file bytes — it takes a JSON body { fileAttachmentId } that references an
 * already-finalized FileAttachment. So the real flow is four steps:
 *
 *   1. POST /api/files/upload-url   → signed PUT URL + storageKey
 *   2. PUT  <uploadUrl>             → bytes go straight to storage (XHR, for
 *                                     byte-level progress on the bar)
 *   3. POST /api/files/finalize     → writes the FileAttachment row → id
 *   4. POST /opportunities/:id/rfp/upload { fileAttachmentId } → 202 + orchestrationId
 *
 * WHY XHR only for step 2: fetch's body stream exposes no upload progress in any
 * browser; XHR's upload.onprogress is the only portable way to drive the bar.
 * Steps 1/3/4 go through api() so auth + /api/v1 normalization stay consistent.
 *
 * Progress/uploading/error live in the zustand store (not hook-local state) so
 * RfpUploadZone (which starts the upload) and RfpUploadProgress (which renders
 * it) — each of which calls this hook — read the same values.
 */
import { useCallback } from 'react';

import { api, ApiError } from '@/lib/api';
import { useRfpPipelineStore } from '@/stores/rfpPipeline';
import type { PipelineEvent } from '@/stores/rfpPipeline';
import type {
  FileAttachment,
  FileFinalizeRequest,
  FileUploadUrlRequest,
  FileUploadUrlResponse,
} from '@bidstack/shared';

interface UploadResult {
  orchestrationId: string;
  bidWorkspaceId: string;
  status?: string;
}

interface UseRfpUploadReturn {
  upload: (file: File, opportunityId: string) => void;
  progress: number; // 0-100
  isUploading: boolean;
  error: string | null;
  cancel: () => void;
}

// Module-level so cancel() aborts the in-flight PUT regardless of which hook
// instance (zone vs progress bar) the user's Cancel button is wired to.
let activeXhr: XMLHttpRequest | null = null;

const CONTENT_TYPE_BY_EXTENSION: Record<string, FileUploadUrlRequest['contentType']> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
  md: 'text/plain',
  markdown: 'text/plain',
  csv: 'text/csv',
  json: 'text/plain',
  xml: 'text/plain',
  html: 'text/plain',
  htm: 'text/plain',
  rtf: 'text/plain',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  tif: 'image/png',
  tiff: 'image/png',
  bmp: 'image/png',
};

function inferRfpContentType(file: File): FileUploadUrlRequest['contentType'] {
  if (
    Object.values(CONTENT_TYPE_BY_EXTENSION).includes(
      file.type as FileUploadUrlRequest['contentType'],
    )
  ) {
    return file.type as FileUploadUrlRequest['contentType'];
  }
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return CONTENT_TYPE_BY_EXTENSION[ext] ?? 'text/plain';
}

/** PUT the raw bytes to storage with byte-level progress. Resolves on 2xx. */
function putBytesWithProgress(
  uploadUrl: string,
  headers: Record<string, string>,
  file: File,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    activeXhr = xhr;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      activeXhr = null;
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Storage upload failed (${xhr.status})`));
    };
    xhr.onerror = () => {
      activeXhr = null;
      reject(new Error('Storage upload failed — network error'));
    };
    xhr.onabort = () => {
      activeXhr = null;
      reject(new DOMException('Upload cancelled', 'AbortError'));
    };
    xhr.open('PUT', uploadUrl);
    xhr.withCredentials = true;
    // Signed-URL adapters (S3) require the exact Content-Type they signed; local
    // mode echoes it for parity. Apply every header the server told us to send.
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.send(file);
  });
}

interface UploadActions {
  setUpload: ReturnType<typeof useRfpPipelineStore.getState>['setUpload'];
  applyEvent: (event: PipelineEvent) => void;
  setOrchestrationId: (id: string) => void;
  setBidWorkspaceId: (id: string) => void;
}

async function runUpload(file: File, opportunityId: string, actions: UploadActions): Promise<void> {
  const { setUpload, applyEvent, setOrchestrationId, setBidWorkspaceId } = actions;

  setUpload({ isUploading: true, uploadProgress: 0, uploadError: null });
  applyEvent({
    stage: 'queued',
    message: 'Uploading document…',
    timestamp: new Date().toISOString(),
    progress: 0,
  });

  try {
    // RFP documents are opportunity-scoped, not CRM-account-scoped. Namespace
    // them under a synthetic accountId so they don't pollute a real account's
    // file list; the rfp/upload route resolves the FileAttachment by id + orgId.
    const accountId = `rfp:${opportunityId}`;
    const contentType = inferRfpContentType(file);

    // 1. Presign.
    const presigned = await api<FileUploadUrlResponse>('/api/files/upload-url', {
      method: 'POST',
      body: {
        accountId,
        name: file.name,
        contentType,
        bytes: file.size,
      } satisfies FileUploadUrlRequest,
    });

    // 2. PUT bytes to storage (progress bar).
    await putBytesWithProgress(presigned.uploadUrl, presigned.headers, file, (pct) =>
      setUpload({ uploadProgress: pct }),
    );

    // 3. Finalize → FileAttachment row.
    const finalized = await api<FileAttachment>('/api/files/finalize', {
      method: 'POST',
      body: {
        accountId,
        storageKey: presigned.storageKey,
        name: file.name,
        contentType,
        bytes: file.size,
      } satisfies FileFinalizeRequest,
    });

    // 4. Start the pipeline.
    const result = await api<UploadResult>(`/api/v1/opportunities/${opportunityId}/rfp/upload`, {
      method: 'POST',
      body: { fileAttachmentId: finalized.id },
    });

    setUpload({ isUploading: false, uploadProgress: 100 });
    setOrchestrationId(result.orchestrationId);
    setBidWorkspaceId(result.bidWorkspaceId);
    applyEvent({
      stage: 'extracting',
      message: 'Upload complete — extracting requirements',
      timestamp: new Date().toISOString(),
      progress: 0,
    });
  } catch (err) {
    // User-initiated cancel: reset to idle silently, no error banner.
    if (err instanceof DOMException && err.name === 'AbortError') {
      setUpload({ isUploading: false, uploadProgress: 0, uploadError: null });
      return;
    }
    const message = err instanceof ApiError || err instanceof Error ? err.message : 'Upload failed';
    setUpload({ isUploading: false, uploadError: message });
    applyEvent({
      stage: 'failed',
      message,
      timestamp: new Date().toISOString(),
      error: message,
    });
  }
}

export function useRfpUpload(): UseRfpUploadReturn {
  const setOrchestrationId = useRfpPipelineStore((s) => s.setOrchestrationId);
  const setBidWorkspaceId = useRfpPipelineStore((s) => s.setBidWorkspaceId);
  const applyEvent = useRfpPipelineStore((s) => s.applyEvent);
  const setUpload = useRfpPipelineStore((s) => s.setUpload);

  const progress = useRfpPipelineStore((s) => s.uploadProgress);
  const isUploading = useRfpPipelineStore((s) => s.isUploading);
  const error = useRfpPipelineStore((s) => s.uploadError);

  const upload = useCallback(
    (file: File, opportunityId: string) => {
      void runUpload(file, opportunityId, {
        setUpload,
        applyEvent,
        setOrchestrationId,
        setBidWorkspaceId,
      });
    },
    [setUpload, applyEvent, setOrchestrationId, setBidWorkspaceId],
  );

  const cancel = useCallback(() => {
    activeXhr?.abort();
  }, []);

  return { upload, progress, isUploading, error, cancel };
}

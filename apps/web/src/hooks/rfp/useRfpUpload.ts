/**
 * File upload with XHR progress tracking.
 *
 * WHY XHR over fetch: fetch's ReadableBody API does not expose upload progress
 * in any major browser. XHR's `upload.onprogress` is the standard way to get
 * byte-level upload progress for the upload progress bar.
 */
import { useState, useCallback, useRef } from 'react';

import { useRfpPipelineStore } from '@/stores/rfpPipeline';

interface UploadResult {
  orchestrationId: string;
  bidWorkspaceId: string;
}

interface UseRfpUploadReturn {
  upload: (file: File, opportunityId: string) => void;
  progress: number; // 0-100
  isUploading: boolean;
  error: string | null;
  cancel: () => void;
}

export function useRfpUpload(): UseRfpUploadReturn {
  const [progress, setProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const setOrchestrationId = useRfpPipelineStore((s) => s.setOrchestrationId);
  const setBidWorkspaceId = useRfpPipelineStore((s) => s.setBidWorkspaceId);
  const applyEvent = useRfpPipelineStore((s) => s.applyEvent);

  const upload = useCallback(
    (file: File, opportunityId: string) => {
      setError(null);
      setProgress(0);
      setIsUploading(true);

      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          setProgress(pct);
        }
      };

      xhr.onload = () => {
        setIsUploading(false);
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const result = JSON.parse(xhr.responseText) as UploadResult;
            setOrchestrationId(result.orchestrationId);
            setBidWorkspaceId(result.bidWorkspaceId);
            applyEvent({
              stage: 'extraction',
              message: 'Upload complete — extracting requirements',
              timestamp: new Date().toISOString(),
              progress: 0,
            });
          } catch {
            setError('Upload succeeded but server response was unreadable');
          }
        } else {
          let message = `Upload failed (${xhr.status})`;
          try {
            const body = JSON.parse(xhr.responseText) as { message?: string };
            if (body.message) message = body.message;
          } catch {
            // use default message
          }
          setError(message);
          applyEvent({
            stage: 'failed',
            message,
            timestamp: new Date().toISOString(),
            error: message,
          });
        }
        xhrRef.current = null;
      };

      xhr.onerror = () => {
        const message = 'Upload failed — network error';
        setError(message);
        setIsUploading(false);
        applyEvent({
          stage: 'failed',
          message,
          timestamp: new Date().toISOString(),
          error: message,
        });
        xhrRef.current = null;
      };

      xhr.onabort = () => {
        setIsUploading(false);
        setProgress(0);
        xhrRef.current = null;
      };

      const form = new FormData();
      form.append('file', file);

      xhr.open('POST', `/api/v1/opportunities/${opportunityId}/rfp/upload`);
      xhr.withCredentials = true;
      xhr.send(form);

      applyEvent({
        stage: 'uploading',
        message: 'Uploading document…',
        timestamp: new Date().toISOString(),
        progress: 0,
      });
    },
    [setOrchestrationId, setBidWorkspaceId, applyEvent],
  );

  const cancel = useCallback(() => {
    xhrRef.current?.abort();
  }, []);

  return { upload, progress, isUploading, error, cancel };
}

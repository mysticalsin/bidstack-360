/**
 * Connects to GET /api/v1/bid-workspaces/:workspaceId/rfp/:orchestrationId/stream via SSE.
 * Parses server-sent events and feeds them into the rfpPipeline Zustand store.
 *
 * WHY SSE over polling: The pipeline can run 2-8 minutes. SSE gives real-time
 * stage updates without polling overhead and without the complexity of WebSockets
 * for a server-push-only stream.
 *
 * QA-9 fixes:
 *  - Signature extended with orchestrationId (was missing; URL never resolved).
 *  - URL corrected to match server route pattern:
 *      /bid-workspaces/:workspaceId/rfp/:orchestrationId/stream
 *    (was /bid-workspaces/:id/pipeline-stream — 404 on every connect).
 *  - Event field mapping: server emits {phase, state, progress, message, updatedAt};
 *    hook now maps these to the PipelineEvent shape the store expects.
 */
import { useEffect, useRef } from 'react';

import { useRfpPipelineStore } from '@/stores/rfpPipeline';
import type { PipelineEvent } from '@/stores/rfpPipeline';

/** Raw SSE frame shape as written by apps/api/src/routes/rfp-pipeline.ts. */
interface ServerSseFrame {
  phase: string | null;
  state: string;
  progress: number | null;
  message: string | null;
  updatedAt: string;
}

export function useRfpPipeline(
  workspaceId: string | null,
  orchestrationId: string | null,
  _opportunityId?: string,
): void {
  const applyEvent = useRfpPipelineStore((s) => s.applyEvent);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!workspaceId || !orchestrationId) return;

    // WHY this exact URL: matches the server route registered as:
    //   GET /bid-workspaces/:workspaceId/rfp/:orchestrationId/stream
    const url = `/api/v1/bid-workspaces/${workspaceId}/rfp/${orchestrationId}/stream`;
    const es = new EventSource(url, { withCredentials: true });
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const frame = JSON.parse(e.data as string) as ServerSseFrame;

        // Map server field names → PipelineEvent shape.
        // WHY: server uses `state` (DB column) and `phase` (sub-stage label).
        // The store tracks `stage` (UI enum) so we forward state → stage.
        const event: PipelineEvent = {
          stage: frame.state as PipelineEvent['stage'],
          message: frame.message ?? '',
          timestamp: frame.updatedAt,
          progress: frame.progress ?? undefined,
          phase: frame.phase ?? undefined,
        };

        applyEvent(event);
      } catch {
        // Malformed SSE data — discard silently; log in dev only.
        if (import.meta.env.DEV) {
          console.warn('[useRfpPipeline] malformed SSE message:', e.data);
        }
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects on transient network errors.
      // Only close explicitly on a terminal stage (handled via store subscriber).
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [workspaceId, orchestrationId, applyEvent]);
}

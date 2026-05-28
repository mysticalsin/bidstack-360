/**
 * Connects to GET /api/v1/bid-workspaces/:bidWorkspaceId/pipeline-stream via SSE.
 * Parses server-sent events and feeds them into the rfpPipeline Zustand store.
 *
 * WHY SSE over polling: The pipeline can run 2-8 minutes. SSE gives real-time
 * stage updates without polling overhead and without the complexity of WebSockets
 * for a server-push-only stream.
 */
import { useEffect, useRef } from 'react';

import { useRfpPipelineStore } from '@/stores/rfpPipeline';
import type { PipelineEvent } from '@/stores/rfpPipeline';

export function useRfpPipeline(bidWorkspaceId: string | null): void {
  const applyEvent = useRfpPipelineStore((s) => s.applyEvent);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!bidWorkspaceId) return;

    const url = `/api/v1/bid-workspaces/${bidWorkspaceId}/pipeline-stream`;
    const es = new EventSource(url, { withCredentials: true });
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data as string) as PipelineEvent;
        applyEvent(event);
      } catch {
        // Malformed SSE data — discard silently; log in dev only
        if (import.meta.env.DEV) {
          console.warn('[useRfpPipeline] malformed SSE message:', e.data);
        }
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects on transient errors.
      // Only close explicitly on a terminal stage (handled by the store subscriber).
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [bidWorkspaceId, applyEvent]);
}

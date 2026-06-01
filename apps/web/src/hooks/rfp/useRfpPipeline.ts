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
  error?: string | null;
}

// The worker keeps RfpOrchestration.state = 'running' for the ENTIRE active
// pipeline and moves only current_phase between steps. So the granular UI stage
// must be derived from `phase`, not `state` — mapping state→stage directly would
// surface the unknown value 'running' for minutes and freeze the progress UI.

// DB current_phase (RfpResponsePhase) → UI PipelineStage.
const PHASE_TO_STAGE: Record<string, PipelineEvent['stage']> = {
  requirement_extract: 'extracting',
  embed: 'extracting',
  story_match: 'story_matching',
  section_draft: 'section_drafting',
  compliance_fill: 'compliance_fill',
  legal_scan: 'legal_scan',
  // No dedicated 'compiling' UI stage — proposal_compile rolls into qa_review,
  // the finalize tail, so the bar reads near-complete during compile.
  proposal_compile: 'qa_review',
  qa_review: 'qa_review',
  awaiting_approval: 'awaiting_approval',
};

// DB state → UI stage for values that carry their own UI meaning: the initial
// queued frame and every terminal/gate state. 'running'/'paused' are absent on
// purpose — while running, the granularity lives in current_phase.
const STATE_TO_STAGE: Record<string, PipelineEvent['stage']> = {
  queued: 'queued',
  awaiting_approval: 'awaiting_approval',
  approved: 'approved',
  completed: 'completed',
  rejected: 'rejected',
  failed: 'failed',
  timeout: 'failed',
};

// Spine phase order, used to scale the numeric progress bar (0-100).
// awaiting_approval is the human gate, not a processing phase, so it's excluded.
const PHASE_ORDER = [
  'requirement_extract',
  'embed',
  'story_match',
  'section_draft',
  'legal_scan',
  'proposal_compile',
  'qa_review',
];

function deriveStage(frame: ServerSseFrame): PipelineEvent['stage'] {
  const byState = STATE_TO_STAGE[frame.state];
  if (byState) return byState;
  if (frame.phase && PHASE_TO_STAGE[frame.phase]) {
    return PHASE_TO_STAGE[frame.phase] as PipelineEvent['stage'];
  }
  // state is 'running'/'paused' with an unknown/absent phase — keep the bar on
  // the first processing step rather than freezing on an unmapped stage.
  return 'extracting';
}

function deriveProgress(frame: ServerSseFrame, stage: PipelineEvent['stage']): number | undefined {
  if (stage === 'awaiting_approval' || stage === 'approved' || stage === 'completed') return 100;
  if (stage === 'queued') return 0;
  if (frame.phase) {
    const idx = PHASE_ORDER.indexOf(frame.phase);
    if (idx >= 0) return Math.round(((idx + 1) / PHASE_ORDER.length) * 100);
  }
  return frame.progress ?? undefined;
}

// Stages after which the server ends the SSE response — close client-side too so
// EventSource doesn't keep reconnecting to a finished stream. awaiting_approval is
// NOT terminal: the human gate keeps streaming until approved/rejected.
const TERMINAL_STAGES = new Set<PipelineEvent['stage']>([
  'completed',
  'failed',
  'rejected',
  'approved',
  'timeout',
]);

export function useRfpPipeline(workspaceId: string | null, orchestrationId: string | null): void {
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

        // Map server fields → PipelineEvent. The DB `state` stays 'running' the
        // whole active pipeline, so derive the granular UI stage from `phase`
        // (see deriveStage). Forward the failure reason so the error banner can
        // show it instead of a generic message.
        const stage = deriveStage(frame);
        const event: PipelineEvent = {
          stage,
          message: frame.message ?? '',
          timestamp: frame.updatedAt,
          progress: deriveProgress(frame, stage),
          phase: frame.phase ?? undefined,
          ...(frame.error ? { error: frame.error } : {}),
        };

        applyEvent(event);

        // Terminal frame: close so EventSource doesn't keep reconnecting to a
        // stream the server has already ended.
        if (TERMINAL_STAGES.has(stage)) {
          es.close();
          esRef.current = null;
        }
      } catch {
        // Malformed SSE data — discard silently.
        // WHY: SSE events are best-effort; a malformed frame should not break the stream.
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects on transient network errors; terminal frames
      // are closed in onmessage above, so there's nothing to do here.
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [workspaceId, orchestrationId, applyEvent]);
}

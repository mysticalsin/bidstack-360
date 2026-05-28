/**
 * QA-9 fixes applied:
 *  - PipelineStage union now covers all server `state` values from
 *    RfpOrchestration.state (Prisma enum) plus client-only sentinels.
 *    Removed 'uploading' and 'extraction' (not emitted by server);
 *    added 'queued', 'extracting', 'completed', 'rejected', 'timeout'.
 *  - PipelineEvent extended with optional `phase` field (server's currentPhase).
 *  - applyEvent guards against out-of-order replay: events whose timestamp
 *    is ≤ the last applied event are discarded (idempotent on reconnect).
 */
import { create } from 'zustand';

/**
 * All `state` values the server can emit in an SSE frame.
 * Must stay in sync with:
 *   - RfpOrchestration.state enum in packages/db/prisma/schema.prisma
 *   - SSE_TERMINAL_STATES in apps/api/src/routes/rfp-pipeline.ts
 *
 * Server terminal states : completed | failed | rejected
 * Server non-terminal    : queued | extracting | story_matching |
 *                          section_drafting | compliance_fill | legal_scan |
 *                          qa_review | awaiting_approval | approved
 * Client-only sentinels  : idle (pre-connect), timeout (server max-poll sentinel)
 */
export type PipelineStage =
  | 'idle'
  | 'queued'
  | 'extracting'
  | 'story_matching'
  | 'section_drafting'
  | 'compliance_fill'
  | 'legal_scan'
  | 'qa_review'
  | 'awaiting_approval'
  | 'approved'
  | 'completed'
  | 'failed'
  | 'rejected'
  | 'timeout';

export interface PipelineEvent {
  stage: PipelineStage;
  message: string;
  timestamp: string; // ISO-8601 — server's updatedAt field
  progress?: number; // 0-100
  error?: string;
  phase?: string; // server's currentPhase sub-label (e.g. "ocr", "embedding")
}

interface RfpPipelineState {
  orchestrationId: string | null;
  bidWorkspaceId: string | null;
  stage: PipelineStage;
  events: PipelineEvent[];
  progress: number; // 0-100 overall
  error: string | null;
  lastEventAt: string | null; // ISO timestamp of the most-recently applied event
  // Actions
  setOrchestrationId: (id: string) => void;
  setBidWorkspaceId: (id: string) => void;
  applyEvent: (event: PipelineEvent) => void;
  reset: () => void;
}

export const useRfpPipelineStore = create<RfpPipelineState>((set) => ({
  orchestrationId: null,
  bidWorkspaceId: null,
  stage: 'idle',
  events: [],
  progress: 0,
  error: null,
  lastEventAt: null,
  setOrchestrationId: (id) => set({ orchestrationId: id }),
  setBidWorkspaceId: (id) => set({ bidWorkspaceId: id }),
  applyEvent: (event) =>
    set((s) => {
      // WHY idempotency guard: EventSource auto-reconnect on network drop can
      // replay the last buffered frame. Discard any event whose timestamp is
      // not strictly newer than the last one we applied to avoid backwards jumps.
      if (s.lastEventAt !== null && event.timestamp <= s.lastEventAt) {
        return s;
      }

      return {
        stage: event.stage,
        progress: event.progress ?? s.progress,
        error: event.error ?? null,
        lastEventAt: event.timestamp,
        // WHY limit 50: prevents unbounded memory growth during long pipelines.
        events: [...s.events, event].slice(-50),
      };
    }),
  reset: () =>
    set({
      orchestrationId: null,
      bidWorkspaceId: null,
      stage: 'idle',
      events: [],
      progress: 0,
      error: null,
      lastEventAt: null,
    }),
}));

import { create } from 'zustand';

export type PipelineStage =
  | 'idle'
  | 'uploading'
  | 'extraction'
  | 'story_matching'
  | 'section_drafting'
  | 'compliance_fill'
  | 'legal_scan'
  | 'qa_review'
  | 'awaiting_approval'
  | 'approved'
  | 'failed';

export interface PipelineEvent {
  stage: PipelineStage;
  message: string;
  timestamp: string;
  progress?: number; // 0-100
  error?: string;
}

interface RfpPipelineState {
  orchestrationId: string | null;
  bidWorkspaceId: string | null;
  stage: PipelineStage;
  events: PipelineEvent[];
  progress: number; // 0-100 overall
  error: string | null;
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
  setOrchestrationId: (id) => set({ orchestrationId: id }),
  setBidWorkspaceId: (id) => set({ bidWorkspaceId: id }),
  applyEvent: (event) =>
    set((s) => ({
      stage: event.stage,
      progress: event.progress ?? s.progress,
      error: event.error ?? null,
      // WHY: keep last 50 to avoid unbounded memory growth during long pipelines
      events: [...s.events, event].slice(-50),
    })),
  reset: () =>
    set({
      orchestrationId: null,
      bidWorkspaceId: null,
      stage: 'idle',
      events: [],
      progress: 0,
      error: null,
    }),
}));

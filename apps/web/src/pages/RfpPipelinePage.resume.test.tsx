// A refresh drops the pipeline store. The page reloads the latest run and
// writes its ids back, but it leaves the stage at idle. Idle is the upload
// zone. The draft, requirements, and approval panels mount only when the
// stage is awaiting_approval, so a bid that is already waiting for review
// offers a second upload until an SSE frame arrives. A frame that never
// connects leaves the review suite hidden.
import type { ReactNode } from 'react';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const OPPORTUNITY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORCHESTRATION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const latest = vi.hoisted(() => ({
  isLoading: false,
  data: {
    orchestration: null as null | {
      id: string;
      state: string;
      currentPhase: string | null;
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock('@/hooks/rfp/useRfpLatestOrchestration', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/rfp/useRfpLatestOrchestration')>(
    '@/hooks/rfp/useRfpLatestOrchestration',
  );
  return {
    ...actual,
    useRfpLatestOrchestration: () => latest,
  };
});

vi.mock('@/hooks/rfp/useRfpDraft', () => ({
  useRfpDraft: () => ({
    query: { data: undefined, isLoading: false, isError: false, error: null },
  }),
}));

vi.mock('@/components/presence/PresenceAvatars', () => ({
  PresenceAvatars: () => null,
}));

vi.mock('@/components/rfp/requirements/RequirementsList', () => ({
  RequirementsList: () => <h2>Extracted requirements</h2>,
}));

vi.mock('@/components/rfp/stories/StoryMatchPanel', () => ({
  StoryMatchPanel: () => null,
}));

vi.mock('@/components/rfp/draft/DraftReviewPane', () => ({
  DraftReviewPane: () => <h2>Draft Sections</h2>,
}));

vi.mock('@/components/rfp/compliance/ComplianceMatrix', () => ({
  ComplianceMatrix: () => null,
}));

vi.mock('@/components/rfp/approval/ApprovalGate', () => ({
  ApprovalGate: () => <h2>Review and approve</h2>,
}));

vi.mock('@/components/rfp/crew/RfpCrewBoard', () => ({
  RfpCrewBoard: () => null,
}));

vi.mock('@/components/rfp/pipeline/PipelineStageCard', () => ({
  PipelineStageCard: ({ stage }: { stage: string }) => <h2>Stage {stage}</h2>,
}));

vi.mock('@/components/rfp/upload/RfpUploadZone', () => ({
  RfpUploadZone: () => <div>Upload RFP Document</div>,
}));

vi.mock('@/components/rfp/upload/RfpUploadProgress', () => ({
  RfpUploadProgress: () => <div>Upload progress</div>,
}));

import { RfpPipelinePage } from './RfpPipelinePage';
import { useRfpPipelineStore } from '@/stores/rfpPipeline';

class SilentEventSource {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  constructor(
    _url: string,
    _opts?: EventSourceInit,
  ) {}
  close() {}
}

function renderPage() {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={[`/rfp/${OPPORTUNITY_ID}/pipeline`]}>
        <Routes>
          <Route path="/rfp/:id/pipeline" element={children} />
        </Routes>
      </MemoryRouter>
    );
  }
  return render(<RfpPipelinePage />, { wrapper: Wrapper });
}

describe('RfpPipelinePage resume', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', SilentEventSource);
    useRfpPipelineStore.getState().reset();
    latest.isLoading = false;
    latest.data = { orchestration: null };
  });

  afterEach(() => {
    cleanup();
    useRfpPipelineStore.getState().reset();
    vi.unstubAllGlobals();
  });

  it('opens the draft review on a refreshed bid that is already awaiting approval', () => {
    // WHY: the saved run is the human gate. Idle paints the upload zone, so
    // the draft the reviewer came back for stays off the page until SSE
    // speaks. The stream is not required to know which stage was saved.
    latest.data = {
      orchestration: {
        id: ORCHESTRATION_ID,
        state: 'awaiting_approval',
        currentPhase: 'awaiting_approval',
      },
    };

    renderPage();

    expect(screen.getByRole('heading', { name: 'Draft Sections' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Review and approve' })).toBeTruthy();
    expect(screen.queryByText('Upload RFP Document')).toBeNull();
    // A later SSE frame must still apply. Stamping lastEventAt here would
    // drop that frame when its updatedAt is the row we already resumed.
    expect(useRfpPipelineStore.getState().stage).toBe('awaiting_approval');
    expect(useRfpPipelineStore.getState().lastEventAt).toBeNull();
    expect(useRfpPipelineStore.getState().orchestrationId).toBe(ORCHESTRATION_ID);
  });

  it('keeps a bid with no saved run on the upload zone', () => {
    // WHY: a first visit has nothing to resume. Hiding the upload zone there
    // would block the only way to start a pipeline.
    latest.data = { orchestration: null };

    renderPage();

    expect(screen.getByText('Upload RFP Document')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Draft Sections' })).toBeNull();
  });

  it('leaves a finished bid on the upload zone so a new file can start', () => {
    // WHY: approved, completed, and failed are not resumable. Painting those
    // stages again would trap the page on a bid that is already done.
    latest.data = {
      orchestration: {
        id: ORCHESTRATION_ID,
        state: 'approved',
        currentPhase: null,
      },
    };

    renderPage();

    expect(screen.getByText('Upload RFP Document')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Draft Sections' })).toBeNull();
    expect(useRfpPipelineStore.getState().stage).toBe('idle');
  });

  it('shows the in-flight stage after refresh instead of the upload zone', () => {
    // WHY: state stays "running" for the whole job. The visible stage is the
    // saved phase. A section draft must not look like a new upload.
    latest.data = {
      orchestration: {
        id: ORCHESTRATION_ID,
        state: 'running',
        currentPhase: 'section_draft',
      },
    };

    renderPage();

    expect(screen.getByRole('heading', { name: 'Stage section_drafting' })).toBeTruthy();
    expect(screen.queryByText('Upload RFP Document')).toBeNull();
    expect(useRfpPipelineStore.getState().lastEventAt).toBeNull();
  });
});

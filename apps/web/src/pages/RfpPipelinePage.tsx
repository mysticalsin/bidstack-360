// Wave 9 — RFP Pipeline page
// Route: /rfp/:id/pipeline  (opportunityId = :id)
// Drives the 7-stage RFP automation pipeline with SSE real-time updates.

import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useRfpPipeline } from '@/hooks/rfp/useRfpPipeline';
import { useRfpLatestOrchestration, RESUMABLE_STATES } from '@/hooks/rfp/useRfpLatestOrchestration';
import { useRfpPipelineStore } from '@/stores/rfpPipeline';
import { useRfpDraft } from '@/hooks/rfp/useRfpDraft';
import { Button } from '@/components/ui/Button';

import { PipelineProgress } from '@/components/rfp/shared/PipelineProgress';
import { RfpUploadZone } from '@/components/rfp/upload/RfpUploadZone';
import { RfpUploadProgress } from '@/components/rfp/upload/RfpUploadProgress';
import { PipelineStageCard } from '@/components/rfp/pipeline/PipelineStageCard';
import { PipelineErrorBanner } from '@/components/rfp/pipeline/PipelineErrorBanner';
import { RequirementsList } from '@/components/rfp/requirements/RequirementsList';
import { StoryMatchPanel } from '@/components/rfp/stories/StoryMatchPanel';
import { DraftReviewPane } from '@/components/rfp/draft/DraftReviewPane';
import { ComplianceMatrix } from '@/components/rfp/compliance/ComplianceMatrix';
import { ApprovalGate } from '@/components/rfp/approval/ApprovalGate';
import { RfpCrewBoard } from '@/components/rfp/crew/RfpCrewBoard';

const ACTIVE_PROCESSING_STAGES = [
  'extracting',
  'story_matching',
  'section_drafting',
  'compliance_fill',
  'legal_scan',
  'qa_review',
] as const;

type ActiveProcessingStage = (typeof ACTIVE_PROCESSING_STAGES)[number];

function isActiveProcessing(stage: string): stage is ActiveProcessingStage {
  return (ACTIVE_PROCESSING_STAGES as readonly string[]).includes(stage);
}

export function RfpPipelinePage() {
  const { t } = useTranslation('rfp');
  const { id: opportunityId } = useParams<{ id: string }>();

  const stage = useRfpPipelineStore((s) => s.stage);
  const progress = useRfpPipelineStore((s) => s.progress);
  const events = useRfpPipelineStore((s) => s.events);
  const error = useRfpPipelineStore((s) => s.error);
  const bidWorkspaceId = useRfpPipelineStore((s) => s.bidWorkspaceId);
  const orchestrationId = useRfpPipelineStore((s) => s.orchestrationId);
  const isUploading = useRfpPipelineStore((s) => s.isUploading);
  const setOrchestrationId = useRfpPipelineStore((s) => s.setOrchestrationId);
  const setBidWorkspaceId = useRfpPipelineStore((s) => s.setBidWorkspaceId);
  const reset = useRfpPipelineStore((s) => s.reset);

  const { query: draftQuery } = useRfpDraft(bidWorkspaceId);
  const proposalId = draftQuery?.data?.proposalId ?? null;

  // Latest orchestration for this opportunity — used to resume a run on refresh.
  const { data: latest } = useRfpLatestOrchestration(opportunityId);

  useDocumentTitle();

  // Start SSE stream once bidWorkspaceId and orchestrationId are known
  useRfpPipeline(bidWorkspaceId, orchestrationId);

  // Reset store on unmount to avoid stale state on re-entry
  useEffect(() => {
    return () => {
      reset();
    };
  }, [reset]);

  // Resume after a refresh: seed the store from the opportunity's latest
  // orchestration so a running pipeline / pending approval picks up where it
  // left off instead of reverting to the upload zone. Guarded so it never
  // clobbers a fresh upload already in flight, and only for resumable states.
  useEffect(() => {
    if (!opportunityId || orchestrationId || isUploading) return;
    const o = latest?.orchestration;
    if (o && RESUMABLE_STATES.has(o.state)) {
      setBidWorkspaceId(opportunityId);
      setOrchestrationId(o.id);
    }
  }, [latest, opportunityId, orchestrationId, isUploading, setBidWorkspaceId, setOrchestrationId]);

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav
        aria-label={t('pipeline.breadcrumbLabel')}
        className="flex items-center gap-1.5 text-xs text-[var(--fg-tertiary)]"
      >
        <Link
          to="/opportunities"
          className="hover:text-[var(--fg-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        >
          {t('pipeline.breadcrumbOpportunities')}
        </Link>
        <span aria-hidden="true">/</span>
        {opportunityId && (
          <>
            <Link
              to={`/opportunities/${opportunityId}`}
              className="max-w-[160px] truncate hover:text-[var(--fg-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            >
              {opportunityId}
            </Link>
            <span aria-hidden="true">/</span>
          </>
        )}
        <span className="font-medium text-[var(--fg-primary)]">{t('pipeline.title')}</span>
      </nav>

      {/* Page heading */}
      <header className="page-head">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--brand-primary)]">
            {t('nav.rfpSection')}
          </p>
          <h1 className="page-title">{t('pipeline.title')}</h1>
          <p className="page-sub">{t('pipeline.subtitle')}</p>
        </div>
      </header>

      {/* Stage progress bar (only shown once pipeline has started) */}
      {stage !== 'idle' && stage !== 'failed' && <PipelineProgress currentStage={stage} />}

      {/* Live crew board — the role-based agents working this RFP, from the
          moment it starts running through review and final approval. */}
      {(isActiveProcessing(stage) || stage === 'awaiting_approval' || stage === 'approved') && (
        <RfpCrewBoard />
      )}

      {/* Stage-conditional panels */}

      {/* 1. Idle — show upload zone */}
      {stage === 'idle' && <RfpUploadZone />}

      {/* 2. Uploading — show progress bar */}
      {stage === 'queued' && <RfpUploadProgress />}

      {/* 3-8. Active processing — stage card with event log */}
      {isActiveProcessing(stage) && (
        <PipelineStageCard stage={stage} progress={progress} events={events} />
      )}

      {/* 9. Awaiting approval — show full review suite */}
      {stage === 'awaiting_approval' && (
        <div className="space-y-4">
          <RequirementsList />
          <StoryMatchPanel />
          <DraftReviewPane />
          <ComplianceMatrix />
          <ApprovalGate />
        </div>
      )}

      {/* 10. Approved — final confirmation */}
      {stage === 'approved' && (
        <div
          role="status"
          className="rounded-2xl border border-[var(--success)] bg-[var(--success-tint)] p-6 text-center"
        >
          <p className="text-lg font-bold text-[var(--success)]">{t('approval.approved')}</p>
          <p className="mt-1 text-sm text-[var(--fg-secondary)]">{t('approval.approvedMessage')}</p>
          {proposalId && (
            <div className="mt-4">
              <Link to={`/proposals/${proposalId}`}>
                <Button variant="primary">View Proposal</Button>
              </Link>
            </div>
          )}
        </div>
      )}

      {/* 11. Failed — error banner with retry */}
      {stage === 'failed' && <PipelineErrorBanner error={error} />}
    </div>
  );
}

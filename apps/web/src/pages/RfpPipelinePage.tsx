// Wave 9 — RFP Pipeline page
// Route: /rfp/:id/pipeline  (opportunityId = :id)
// Drives the 7-stage RFP automation pipeline with SSE real-time updates.

import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useRfpPipeline } from '@/hooks/rfp/useRfpPipeline';
import { useRfpPipelineStore } from '@/stores/rfpPipeline';

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
  const reset = useRfpPipelineStore((s) => s.reset);

  useDocumentTitle();

  // Start SSE stream once bidWorkspaceId and orchestrationId are known
  useRfpPipeline(bidWorkspaceId, orchestrationId);

  // Reset store on unmount to avoid stale state on re-entry
  useEffect(() => {
    return () => {
      reset();
    };
  }, [reset]);

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
          className="rounded-2xl border border-green-200 bg-green-50 p-6 text-center dark:border-green-800 dark:bg-green-950/20"
        >
          <p className="text-lg font-bold text-green-800 dark:text-green-200">
            {t('approval.approved')}
          </p>
          <p className="mt-1 text-sm text-green-700 dark:text-green-300">
            {t('approval.approvedMessage')}
          </p>
        </div>
      )}

      {/* 11. Failed — error banner with retry */}
      {stage === 'failed' && <PipelineErrorBanner error={error} />}
    </div>
  );
}

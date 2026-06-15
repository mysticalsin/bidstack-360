import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import type { PipelineStage } from '@/stores/rfpPipeline';

interface RfpStatusChipProps {
  stage: PipelineStage;
}

// WHY queued/extracting: QA-9 aligned stage names to server RfpOrchestration.state values.
// Old: 'uploading' → 'queued' (server queues the job, not the client upload)
// Old: 'extraction' → 'extracting' (server uses present-participle naming)
const STAGE_STYLES: Record<PipelineStage, string> = {
  idle: 'bg-[var(--tag-gray-bg)] text-[var(--tag-gray-fg)]',
  queued: 'bg-[var(--tag-blue-bg)] text-[var(--tag-blue-fg)]',
  extracting: 'bg-[var(--tag-purple-bg)] text-[var(--tag-purple-fg)]',
  story_matching: 'bg-[var(--tag-purple-bg)] text-[var(--tag-purple-fg)]',
  section_drafting: 'bg-[var(--tag-purple-bg)] text-[var(--tag-purple-fg)]',
  compliance_fill: 'bg-[var(--tag-teal-bg)] text-[var(--tag-teal-fg)]',
  legal_scan: 'bg-[var(--tag-amber-bg)] text-[var(--tag-amber-fg)]',
  qa_review: 'bg-[var(--tag-amber-bg)] text-[var(--tag-amber-fg)]',
  awaiting_approval: 'bg-[var(--tag-amber-bg)] text-[var(--tag-amber-fg)]',
  approved: 'bg-[var(--tag-jade-bg)] text-[var(--tag-jade-fg)]',
  completed: 'bg-[var(--tag-jade-bg)] text-[var(--tag-jade-fg)]',
  failed: 'bg-[var(--tag-tomato-bg)] text-[var(--tag-tomato-fg)]',
  rejected: 'bg-[var(--tag-tomato-bg)] text-[var(--tag-tomato-fg)]',
  timeout: 'bg-[var(--tag-gray-bg)] text-[var(--tag-gray-fg)]',
};

function stageLabels(t: TFunction): Record<PipelineStage, string> {
  return {
    idle: t('rfpStatusChip.stageIdle', 'Idle'),
    queued: t('rfpStatusChip.stageQueued', 'Queued'),
    extracting: t('rfpStatusChip.stageExtracting', 'Extracting'),
    story_matching: t('rfpStatusChip.stageStoryMatching', 'Matching Stories'),
    section_drafting: t('rfpStatusChip.stageSectionDrafting', 'Drafting'),
    compliance_fill: t('rfpStatusChip.stageComplianceFill', 'Compliance'),
    legal_scan: t('rfpStatusChip.stageLegalScan', 'Review Crew'),
    qa_review: t('rfpStatusChip.stageQaReview', 'QA Review'),
    awaiting_approval: t('rfpStatusChip.stageAwaitingApproval', 'Awaiting Approval'),
    approved: t('rfpStatusChip.stageApproved', 'Approved'),
    completed: t('rfpStatusChip.stageCompleted', 'Completed'),
    failed: t('rfpStatusChip.stageFailed', 'Failed'),
    rejected: t('rfpStatusChip.stageRejected', 'Rejected'),
    timeout: t('rfpStatusChip.stageTimeout', 'Timed Out'),
  };
}

export function RfpStatusChip({ stage }: RfpStatusChipProps) {
  const { t } = useTranslation('rfp');
  const label = stageLabels(t)[stage];

  return (
    <span
      className={`inline-flex h-5 items-center rounded-full px-2 text-[10px] font-semibold ${STAGE_STYLES[stage]}`}
      aria-label={t('rfpStatusChip.ariaPipelineStatus', 'Pipeline status: {{status}}', { status: label })}
    >
      {label}
    </span>
  );
}

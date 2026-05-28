import type { PipelineStage } from '@/stores/rfpPipeline';

interface RfpStatusChipProps {
  stage: PipelineStage;
}

// WHY queued/extracting: QA-9 aligned stage names to server RfpOrchestration.state values.
// Old: 'uploading' → 'queued' (server queues the job, not the client upload)
// Old: 'extraction' → 'extracting' (server uses present-participle naming)
const STAGE_STYLES: Record<PipelineStage, string> = {
  idle: 'bg-[var(--surface-sunken)] text-[var(--fg-secondary)]',
  queued: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  extracting: 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300',
  story_matching: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  section_drafting: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  compliance_fill: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300',
  legal_scan: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  qa_review: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  awaiting_approval: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  approved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  timeout: 'bg-[var(--surface-sunken)] text-[var(--fg-secondary)]',
};

const STAGE_LABELS: Record<PipelineStage, string> = {
  idle: 'Idle',
  queued: 'Queued',
  extracting: 'Extracting',
  story_matching: 'Matching Stories',
  section_drafting: 'Drafting',
  compliance_fill: 'Compliance',
  legal_scan: 'Legal Scan',
  qa_review: 'QA Review',
  awaiting_approval: 'Awaiting Approval',
  approved: 'Approved',
  completed: 'Completed',
  failed: 'Failed',
  rejected: 'Rejected',
  timeout: 'Timed Out',
};

export function RfpStatusChip({ stage }: RfpStatusChipProps) {
  return (
    <span
      className={`inline-flex h-5 items-center rounded-full px-2 text-[10px] font-semibold ${STAGE_STYLES[stage]}`}
      aria-label={`Pipeline status: ${STAGE_LABELS[stage]}`}
    >
      {STAGE_LABELS[stage]}
    </span>
  );
}

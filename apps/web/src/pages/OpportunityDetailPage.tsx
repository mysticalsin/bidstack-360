import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { DueDateChip } from '@/components/ui/DueDateChip';
import { EmptyState, ErrorState } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import { confirm } from '@/components/ui/ConfirmDialog';
import { api } from '@/lib/api';
import { DetailPageSkeleton } from '@/components/skeletons/DetailPageSkeleton';
import { BriefingDialog } from '@/components/opportunity/BriefingDialog';
import {
  InlineEditDate,
  InlineEditNumber,
  InlineEditSelect,
  InlineEditText,
} from '@/components/opportunity/InlineEdit';
import { BuyingGroupList } from '@/components/opportunity/BuyingGroupList';
import { OpportunityTabs } from '@/components/opportunity/OpportunityTabs';
import { PresenceAvatars } from '@/components/presence/PresenceAvatars';
import { OpportunityAccountIntel } from '@/components/opportunity/OpportunityAccountIntel';
import { CustomFieldValuesSection } from '@/components/CustomFieldValuesSection';
import { CollaborativeNotesSection } from '@/components/editor/CollaborativeNotesSection';
import { CreateTaskDialog } from '@/components/task/CreateTaskDialog';
import { ScheduleReviewDialog } from '@/components/calls/ScheduleReviewDialog';
import { usePatchOpportunity, useOpportunity } from '@/hooks/useOpportunities';
import { useTasks } from '@/hooks/useTasks';
import {
  formatUnspecifiedAmount,
  UNSPECIFIED_CURRENCY_BASIS,
} from '@/components/dashboard/unspecified-currency';
import { useCommandContext } from '@/hooks/useCommandContext';
import { useStageMutation } from '@/hooks/useStageMutation';
import { formatDate, formatStage } from '@/lib/format';
import { presentOpportunityIntel, type OpportunityStage, type IntelPayload, type Task } from '@bidstack/shared';

import {
  DataFreshnessRibbon,
  FinancialHealthCard,
  WinPredictionCard,
  TriggersCard,
  CompetitorRadarCard,
  NewsCard,
} from './opportunityDetail/IntelCards';
import { BidScoreCard } from './opportunityDetail/BidScoreCard';
import { recordedProbability } from './opportunityDetail/intel-honesty';
import { TimelinePanel } from './opportunityDetail/TimelinePanel';

export function OpportunityDetailPage() {
  const { t } = useTranslation('crm');
  const stageOptions: ReadonlyArray<{ value: OpportunityStage; label: string }> = [
    { value: 's1_lead', label: t('opportunityDetail.stageS1Lead', 'S1 Lead') },
    { value: 's1_ongoing', label: t('opportunityDetail.stageS1Ongoing', 'S1 Ongoing') },
    { value: 's2_sent', label: t('opportunityDetail.stageS2Sent', 'S2 Sent') },
    {
      value: 's3_technical_iteration',
      label: t('opportunityDetail.stageS3TechnicalIteration', 'S3 Technical Iteration'),
    },
    { value: 's4_negotiation', label: t('opportunityDetail.stageS4Negotiation', 'S4 Negotiation') },
    { value: 'closed_won', label: t('opportunityDetail.stageClosedWon', 'Closed won') },
    { value: 'closed_lost', label: t('opportunityDetail.stageClosedLost', 'Closed lost') },
  ];
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, isError, error } = useOpportunity(id);
  const dealTasks = useTasks(id ? { oppId: id, limit: 20 } : { limit: 1 });
  const patch = usePatchOpportunity();
  const stageMove = useStageMutation();
  const [briefOpen, setBriefOpen] = useState(false);
  const intel: IntelPayload = presentOpportunityIntel(data?.intel ?? {});
  const nav = useNavigate();
  const qc = useQueryClient();
  const [isDeleting, setIsDeleting] = useState(false);
  const handleDelete = async () => {
    if (!id) return;
    const ok = await confirm({
      title: t('opportunityDetail.confirmDelete.title', 'Delete this opportunity?'),
      description: t(
        'opportunityDetail.confirmDelete.description',
        'This cannot be undone from the UI — the audit log records the delete.',
      ),
      confirmLabel: t('opportunityDetail.confirmDelete.confirm', 'Delete'),
      destructive: true,
    });
    if (!ok) return;
    setIsDeleting(true);
    try {
      await api(`/api/opportunities/${id}`, { method: 'DELETE' });
      void qc.invalidateQueries({ queryKey: ['opportunities'] });
      toast.success(t('opportunityDetail.toast.deleted', 'Opportunity deleted'));
      nav('/opportunities');
    } catch {
      toast.error(t('opportunityDetail.toast.deleteFailed', 'Failed to delete opportunity'));
      setIsDeleting(false);
    }
  };

  // Register contextual commands for this page in the global Cmd+K palette.
  // WHY: Twenty's command menu surfaces page-specific actions; we adapt the
  // pattern so the palette becomes a true action hub, not just navigation.
  const [taskOpen, setTaskOpen] = useState(false);
  useCommandContext(
    data
      ? [
          {
            id: 'opp-create-task',
            label: t('opportunityDetail.commandCreateTaskLabel', 'Create task for {{name}}', {
              name: data.name,
            }),
            hint: t('opportunityDetail.commandCreateTaskHint', 'Add a to-do linked to this opportunity'),
            onSelect: () => setTaskOpen(true),
          },
          {
            id: 'opp-open-briefing',
            label: t('opportunityDetail.commandBriefingLabel', 'Open AI briefing for {{name}}', {
              name: data.name,
            }),
            hint: t('opportunityDetail.commandBriefingHint', 'Generate a Dust AI briefing document'),
            onSelect: () => setBriefOpen(true),
          },
        ]
      : [],
  );

  if (isLoading) return <DetailPageSkeleton tabs columns={2} cards={3} />;
  if (isError)
    return (
      <ErrorState
        title={t('opportunityDetail.errorTitle', "Couldn't load this opportunity")}
        message={error?.message ?? '—'}
      />
    );
  if (!data) {
    return (
      <EmptyState
        title={t('opportunityDetail.notFoundTitle', 'Opportunity not found')}
        message={t(
          'opportunityDetail.notFoundMessage',
          'The opportunity may have been deleted or you may not have access to it.',
        )}
        action={
          <Button variant="secondary" onClick={() => window.history.back()}>
            {t('opportunityDetail.goBack', 'Go back')}
          </Button>
        }
      />
    );
  }

  const isWon = data.pipelineStage?.isWon || data.stage === 'closed_won';
  const isLost = data.pipelineStage?.isLost || data.stage === 'closed_lost';
  const isOutcomeLocked = isWon || isLost;
  const nextTask = pickNextTask(dealTasks.data?.items);
  const moveToOutcome = (stage: 'closed_won' | 'closed_lost') => {
    stageMove.mutate(
      { id: data.id, pipelineStageId: stage },
      {
        onError: () => {
          toast.error(t('opportunityDetail.outcomeUpdateFailed', 'Could not update outcome.'));
        },
      },
    );
  };

  return (
    <div className="space-y-6">
      <header className="border-b border-[var(--border-subtle)] pb-6">
          <div className="mb-4 flex items-center justify-between gap-4">
            <nav
              aria-label={t('opportunityDetail.breadcrumbAriaLabel', 'Breadcrumb')}
              className="text-sm text-[var(--fg-secondary)]"
            >
              <ol className="flex items-center gap-2">
                <li>
                  <Link
                    to="/opportunities"
                    className="inline-flex min-h-11 items-center hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
                  >
                    {t('opportunityDetail.breadcrumbOpportunities', 'Opportunities')}
                  </Link>
                </li>
                <li aria-hidden="true" className="text-[var(--fg-tertiary)]">
                  /
                </li>
                <li aria-current="page">{data.code}</li>
              </ol>
            </nav>
            <PresenceAvatars entityType="opportunity" entityId={data.id} />
          </div>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div className="min-w-0">
              <h1 className="text-[28px] font-medium text-[var(--fg-primary)]">
                <InlineEditText
                  value={data.name}
                  onSave={(v) => patch.mutateAsync({ id: id!, patch: { name: v } })}
                  label={t('opportunityDetail.editNameLabel', 'Edit opportunity name')}
                  validate={(v) =>
                    v.length < 1 ? t('opportunityDetail.nameRequired', 'Name is required') : null
                  }
                />
              </h1>
              <p className="mt-1 text-sm text-[var(--fg-secondary)]">
                <InlineEditText
                  value={data.customer}
                  onSave={(v) => patch.mutateAsync({ id: id!, patch: { customer: v } })}
                  label={t('opportunityDetail.editCustomerLabel', 'Edit customer name')}
                  validate={(v) =>
                    v.length < 1
                      ? t('opportunityDetail.customerRequired', 'Customer is required')
                      : null
                  }
                />
              </p>
            </div>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-8">
              <div>
                <dt className="text-sm text-[var(--fg-secondary)]">
                  {t('opportunityDetail.valueLabel', 'Value')}
                </dt>
                <dd className="mt-1 text-2xl font-medium tabular-nums text-[var(--fg-primary)]">
                  <InlineEditNumber
                    value={data.value}
                    onSave={(v) => patch.mutateAsync({ id: id!, patch: { value: v } })}
                    label={t(
                      'opportunityDetail.editValueLabel',
                      'Edit deal value (currency not recorded)',
                    )}
                    min={0}
                    step={1000}
                    display={(v) => formatUnspecifiedAmount(v)}
                  />
                </dd>
                <p className="mt-1 max-w-[16rem] text-xs text-[var(--fg-secondary)]">
                  {UNSPECIFIED_CURRENCY_BASIS}
                </p>
              </div>
              <div>
                <dt className="text-sm text-[var(--fg-secondary)]">
                  {t('opportunityDetail.stageLabel', 'Stage')}
                </dt>
                <dd className="mt-1">
                  <InlineEditSelect<OpportunityStage>
                    value={data.stage as OpportunityStage}
                    onSave={(v) => patch.mutateAsync({ id: id!, patch: { stage: v } })}
                    options={stageOptions}
                    label={t('opportunityDetail.changeStageLabel', 'Change stage')}
                    display={(v) => <span className="text-sm text-[var(--fg-primary)]">{formatStage(v)}</span>}
                  />
                </dd>
              </div>
              <div>
                <dt className="text-sm text-[var(--fg-secondary)]">
                  {t('opportunityDetail.nextStepLabel', 'Next step')}
                </dt>
                <dd className="mt-1 text-sm text-[var(--fg-primary)]">
                  {nextTask
                    ? nextTask.title
                    : data.dueDate
                      ? t('opportunityDetail.nextStepDue', 'Due {{date}}', {
                          date: formatDate(data.dueDate),
                        })
                      : t('opportunityDetail.nextStepEmpty', 'No next step')}
                </dd>
                {nextTask?.dueDate ? (
                  <p className="mt-1 text-xs text-[var(--fg-secondary)]">{formatDate(nextTask.dueDate)}</p>
                ) : null}
              </div>
            </dl>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <CreateTaskDialog
              oppId={data.id}
              trigger={
                <Button variant="secondary" size="sm">
                  {t('opportunityDetail.addTaskButton', 'Add task')}
                </Button>
              }
            />
            <Link to={`/rfp/${data.id}/pipeline`}>
              <Button variant="ghost" size="sm">
                {t('opportunityDetail.rfpPipelineButton', 'RFP pipeline')}
              </Button>
            </Link>
            <ScheduleReviewDialog
              entityType="OPPORTUNITY"
              entityId={data.id}
              defaultTopic={t('opportunityDetail.reviewDefaultTopic', 'Go/No-Go review — {{name}}', {
                name: data.name,
              })}
              trigger={
                <Button variant="ghost" size="sm">
                  {t('opportunityDetail.scheduleReviewButton', 'Schedule review')}
                </Button>
              }
            />
            <Button variant="ghost" size="sm" onClick={() => setBriefOpen(true)}>
              {t('opportunityDetail.askDustButton', 'Ask Dust')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-[var(--danger)]"
              disabled={isDeleting}
              onClick={handleDelete}
            >
              {isDeleting
                ? t('opportunityDetail.deleting', 'Deleting…')
                : t('opportunityDetail.deleteButton', 'Delete')}
            </Button>
            {isWon ? (
              <Button variant="success" size="sm" disabled>
                {t('opportunityDetail.wonStatusButton', 'Won')}
              </Button>
            ) : (
              <Button
                variant="success"
                size="sm"
                disabled={stageMove.isPending || isOutcomeLocked}
                onClick={() => moveToOutcome('closed_won')}
              >
                {stageMove.isPending
                  ? t('opportunityDetail.markWonPendingButton', 'Closing...')
                  : t('opportunityDetail.markWonButton', 'Mark won')}
              </Button>
            )}
            {isLost ? (
              <Button variant="destructive" size="sm" disabled>
                {t('opportunityDetail.lostStatusButton', 'Lost')}
              </Button>
            ) : (
              <Button
                variant="destructive"
                size="sm"
                disabled={stageMove.isPending || isOutcomeLocked}
                onClick={() => moveToOutcome('closed_lost')}
              >
                {stageMove.isPending
                  ? t('opportunityDetail.markLostPendingButton', 'Closing...')
                  : t('opportunityDetail.markLostButton', 'Mark lost')}
              </Button>
            )}
            <span className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--fg-secondary)]">
              {recordedProbability(data.probability) !== null ? (
                <>
                  <InlineEditNumber
                    value={data.probability}
                    onSave={(v) => patch.mutateAsync({ id: id!, patch: { probability: v } })}
                    label={t('opportunityDetail.editProbabilityLabel', 'Edit probability')}
                    min={0}
                    max={100}
                    step={5}
                    suffix="%"
                  />
                  <span>
                    {t('opportunityDetail.storedProbabilityProxy', 'stored probability proxy')}
                  </span>
                </>
              ) : null}
              <InlineEditDate
                value={data.dueDate}
                onSave={(v) => patch.mutateAsync({ id: id!, patch: { dueDate: v } })}
                label={t('opportunityDetail.editDueDateLabel', 'Edit due date')}
                display={(v) => formatDate(v)}
              />
              <DueDateChip dueDate={data.dueDate} size="lg" />
            </span>
          </div>
        </header>

      <BriefingDialog
        opportunityId={data.id}
        opportunityLabel={data.name}
        open={briefOpen}
        onOpenChange={setBriefOpen}
      />

      <DataFreshnessRibbon intel={intel} />

      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
        <FinancialHealthCard intel={intel} />
        <WinPredictionCard intel={intel} />
        <BidScoreCard opportunityId={data.id} />
        <OpportunityAccountIntel accountId={data.customer} />
      </div>

      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
        <TriggersCard intel={intel} />
        <CompetitorRadarCard intel={intel} />
      </div>

      <NewsCard intel={intel} />

      <BuyingGroupList opportunityId={data.id} />

      <OpportunityTabs
        oppId={data.id}
        customer={data.customer}
        intelDecisionUnit={intel.decisionUnit ?? []}
        documents={data.documents}
        activityContent={<TimelinePanel oppId={data.id} />}
      />

      <CustomFieldValuesSection entityType="opportunity" entityId={id!} />

      {/* Wave 8 — Collaborative scratch-pad: real-time CRDT rich-text. */}
      <CollaborativeNotesSection
        entityType="opportunity"
        entityId={id}
        fieldKey="notes"
        label={t('opportunityDetail.liveCollaborationLabel', 'Live collaboration')}
      />

      {/* Controlled CreateTaskDialog driven by the command palette (A3). */}
      <CreateTaskDialog oppId={data.id} open={taskOpen} onOpenChange={setTaskOpen} />
    </div>
  );
}

function pickNextTask(items: Task[] | undefined): Task | undefined {
  return (items ?? [])
    .filter((task) => task.status !== 'done')
    .sort((a, b) => (a.dueDate ?? '9999-99-99').localeCompare(b.dueDate ?? '9999-99-99'))[0];
}

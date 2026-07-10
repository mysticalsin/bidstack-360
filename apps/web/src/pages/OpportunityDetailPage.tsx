import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { Badge, stageTone } from '@/components/ui/Badge';
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
import { OpportunityTabs } from '@/components/opportunity/OpportunityTabs';
import { PresenceAvatars } from '@/components/presence/PresenceAvatars';
import { OpportunityAccountIntel } from '@/components/opportunity/OpportunityAccountIntel';
import { CustomFieldValuesSection } from '@/components/CustomFieldValuesSection';
import { CollaborativeNotesSection } from '@/components/editor/CollaborativeNotesSection';
import { CreateTaskDialog } from '@/components/task/CreateTaskDialog';
import { ScheduleReviewDialog } from '@/components/calls/ScheduleReviewDialog';
import { GlassCard } from '@/components/ui/GlassCard';
import { Icon } from '@/components/ui/Icon';
import { MagneticButton } from '@/components/ui/MagneticButton';
import { usePatchOpportunity, useOpportunity } from '@/hooks/useOpportunities';
import { useCommandContext } from '@/hooks/useCommandContext';
import { useStageMutation } from '@/hooks/useStageMutation';
import { formatDate, formatMoney, formatStage } from '@/lib/format';
import type { OpportunityStage, IntelPayload } from '@bidstack/shared';

import {
  DataFreshnessRibbon,
  FinancialHealthCard,
  WinPredictionCard,
  TriggersCard,
  CompetitorRadarCard,
  NewsCard,
} from './opportunityDetail/IntelCards';
import { BidScoreCard } from './opportunityDetail/BidScoreCard';
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
  const patch = usePatchOpportunity();
  const stageMove = useStageMutation();
  const [briefOpen, setBriefOpen] = useState(false);
  const intel: IntelPayload = data?.intel ?? {};
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
      <GlassCard
        padding="lg"
        className="border-none bg-gradient-to-br from-[var(--surface-card)] to-[var(--surface-sunken-alpha)] shadow-2xl"
      >
        <header>
          <div className="mb-4 flex items-center justify-between gap-4">
            <nav
              aria-label={t('opportunityDetail.breadcrumbAriaLabel', 'Breadcrumb')}
              className="text-xs text-[var(--fg-tertiary)]"
            >
              <ol className="flex items-center gap-2">
                <li>
                  <Link
                    to="/opportunities"
                    className="hover:text-[var(--brand-primary)] transition-colors"
                  >
                    {t('opportunityDetail.breadcrumbOpportunities', 'Opportunities')}
                  </Link>
                </li>
                <li aria-hidden="true" className="opacity-30">
                  /
                </li>
                <li aria-current="page" className="font-mono">
                  {data.code}
                </li>
              </ol>
            </nav>
            {/* A3 — who else is looking at this bid right now. */}
            <PresenceAvatars entityType="opportunity" entityId={data.id} />
          </div>
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0 flex-1">
              <h1 className="text-3xl font-bold tracking-tight text-[var(--fg-primary)] sm:text-4xl">
                <InlineEditText
                  value={data.name}
                  onSave={(v) => patch.mutateAsync({ id: id!, patch: { name: v } })}
                  label={t('opportunityDetail.editNameLabel', 'Edit opportunity name')}
                  validate={(v) =>
                    v.length < 1 ? t('opportunityDetail.nameRequired', 'Name is required') : null
                  }
                />
              </h1>
              <div className="mt-2 flex items-center gap-2 text-sm text-[var(--fg-secondary)]">
                <span className="flex items-center gap-1.5 font-medium">
                  <Icon name="building" size={14} className="text-[var(--brand-primary)]" />
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
                </span>
                <span className="opacity-30">|</span>
                <span className="flex items-center gap-1.5">
                  <Icon name="reports" size={14} className="text-[var(--info)]" />
                  <InlineEditText
                    value={data.industry ?? ''}
                    onSave={(v) => patch.mutateAsync({ id: id!, patch: { industry: v || null } })}
                    label={t('opportunityDetail.editIndustryLabel', 'Edit industry')}
                    display={(v) => v || '—'}
                    placeholder={t('opportunityDetail.industryPlaceholder', 'Industry')}
                  />
                </span>
                <span className="opacity-30">|</span>
                <span className="flex items-center gap-1.5">
                  <Icon name="globe" size={14} className="text-[var(--success)]" />
                  {data.territoryName ? (
                    <Badge tone="teal">{data.territoryName}</Badge>
                  ) : data.country ? (
                    <span className="text-sm">{data.country}</span>
                  ) : (
                    <span className="text-sm text-[var(--fg-tertiary)]">—</span>
                  )}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2 bg-[var(--surface-sunken-alpha)] p-1 rounded-full border border-[var(--border-subtle)]">
                <CreateTaskDialog
                  oppId={data.id}
                  trigger={
                    <Button variant="ghost" size="sm" className="rounded-full">
                      {t('opportunityDetail.addTaskButton', '+ Task')}
                    </Button>
                  }
                />
                <Link to={`/rfp/${data.id}/pipeline`}>
                  <Button variant="ghost" size="sm" className="rounded-full">
                    <Icon name="wand" size={12} className="text-[var(--brand-primary)] mr-1" />
                    {t('opportunityDetail.rfpPipelineButton', 'RFP Pipeline')}
                  </Button>
                </Link>
                <ScheduleReviewDialog
                  entityType="OPPORTUNITY"
                  entityId={data.id}
                  defaultTopic={t('opportunityDetail.reviewDefaultTopic', 'Go/No-Go review — {{name}}', {
                    name: data.name,
                  })}
                  trigger={
                    <Button variant="ghost" size="sm" className="rounded-full">
                      <Icon name="clock" size={12} className="text-[var(--brand-primary)] mr-1" />
                      {t('opportunityDetail.scheduleReviewButton', 'Schedule review')}
                    </Button>
                  }
                />
                <MagneticButton
                  onClick={() => setBriefOpen(true)}
                  className="h-8 px-4 text-xs shadow-none"
                >
                  {t('opportunityDetail.askDustButton', 'Ask Dust')}
                </MagneticButton>
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-full text-[var(--danger)]"
                  disabled={isDeleting}
                  onClick={handleDelete}
                >
                  <Icon name="trash" size={13} className="mr-1" />
                  {isDeleting
                    ? t('opportunityDetail.deleting', 'Deleting…')
                    : t('opportunityDetail.deleteButton', 'Delete')}
                </Button>
              </div>
              <div
                className="flex flex-wrap items-center gap-2"
                aria-label={t('opportunityDetail.outcomeActionsLabel', 'Opportunity outcome actions')}
              >
                {isWon ? (
                  <Button variant="success" size="sm" disabled className="rounded-full">
                    <Icon name="trophy" size={13} />
                    {t('opportunityDetail.wonStatusButton', 'Won')}
                  </Button>
                ) : (
                  <Button
                    variant="success"
                    size="sm"
                    className="rounded-full"
                    disabled={stageMove.isPending || isOutcomeLocked}
                    onClick={() => moveToOutcome('closed_won')}
                  >
                    <Icon name="trophy" size={13} />
                    {stageMove.isPending
                      ? t('opportunityDetail.markWonPendingButton', 'Closing...')
                      : t('opportunityDetail.markWonButton', 'Mark Won')}
                  </Button>
                )}
                {isLost ? (
                  <Button variant="destructive" size="sm" disabled className="rounded-full">
                    <Icon name="close" size={13} />
                    {t('opportunityDetail.lostStatusButton', 'Lost')}
                  </Button>
                ) : (
                  <Button
                    variant="destructive"
                    size="sm"
                    className="rounded-full"
                    disabled={stageMove.isPending || isOutcomeLocked}
                    onClick={() => moveToOutcome('closed_lost')}
                  >
                    <Icon name="close" size={13} />
                    {stageMove.isPending
                      ? t('opportunityDetail.markLostPendingButton', 'Closing...')
                      : t('opportunityDetail.markLostButton', 'Mark Lost')}
                  </Button>
                )}
              </div>
              <InlineEditSelect<OpportunityStage>
                value={data.stage as OpportunityStage}
                onSave={(v) => patch.mutateAsync({ id: id!, patch: { stage: v } })}
                options={stageOptions}
                label={t('opportunityDetail.changeStageLabel', 'Change stage')}
                display={(v) => (
                  <Badge tone={stageTone(v)} className="px-4 py-1 text-xs uppercase tracking-wider">
                    {formatStage(v)}
                  </Badge>
                )}
              />
              <div className="text-right border-l border-[var(--border-subtle)] pl-4">
                <div className="text-3xl font-bold tabular-nums text-[var(--fg-primary)] tracking-tight">
                  <InlineEditNumber
                    value={data.value}
                    onSave={(v) => patch.mutateAsync({ id: id!, patch: { value: v } })}
                    label={t('opportunityDetail.editValueLabel', 'Edit deal value (EUR)')}
                    min={0}
                    step={1000}
                    display={(v) => formatMoney(v, 'EUR')}
                  />
                </div>
                <div className="flex items-center justify-end gap-2 text-xs text-[var(--fg-tertiary)] mt-1">
                  <span className="flex items-center gap-1">
                    <span className="font-semibold text-[var(--success)]">
                      <InlineEditNumber
                        value={data.probability}
                        onSave={(v) => patch.mutateAsync({ id: id!, patch: { probability: v } })}
                        label={t('opportunityDetail.editProbabilityLabel', 'Edit probability')}
                        min={0}
                        max={100}
                        step={5}
                        suffix="%"
                      />
                    </span>
                    <span>{t('opportunityDetail.likely', 'likely')}</span>
                  </span>
                  <span className="opacity-30">·</span>
                  <span className="flex items-center gap-2">
                    <Icon name="clock" size={12} />
                    <InlineEditDate
                      value={data.dueDate}
                      onSave={(v) => patch.mutateAsync({ id: id!, patch: { dueDate: v } })}
                      label={t('opportunityDetail.editDueDateLabel', 'Edit due date')}
                      display={(v) => formatDate(v)}
                    />
                    <DueDateChip dueDate={data.dueDate} size="lg" />
                  </span>
                </div>
              </div>
            </div>
          </div>
        </header>
      </GlassCard>

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

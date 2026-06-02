import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';

import { Badge, stageTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState } from '@/components/ui/StateMessages';
import { DetailPageSkeleton } from '@/components/skeletons/DetailPageSkeleton';
import { BriefingDialog } from '@/components/opportunity/BriefingDialog';
import {
  InlineEditDate,
  InlineEditNumber,
  InlineEditSelect,
  InlineEditText,
} from '@/components/opportunity/InlineEdit';
import { OpportunityTabs } from '@/components/opportunity/OpportunityTabs';
import { OpportunityAccountIntel } from '@/components/opportunity/OpportunityAccountIntel';
import { CustomFieldValuesSection } from '@/components/CustomFieldValuesSection';
import { CollaborativeNotesSection } from '@/components/editor/CollaborativeNotesSection';
import { CreateTaskDialog } from '@/components/task/CreateTaskDialog';
import { GlassCard } from '@/components/ui/GlassCard';
import { Icon } from '@/components/ui/Icon';
import { MagneticButton } from '@/components/ui/MagneticButton';
import { usePatchOpportunity, useOpportunity } from '@/hooks/useOpportunities';
import { useOpportunityTimeline } from '@/hooks/useOpportunityTimeline';
import { useCommandContext } from '@/hooks/useCommandContext';
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

const STAGE_OPTIONS: ReadonlyArray<{ value: OpportunityStage; label: string }> = [
  { value: 's1_lead', label: 'S1 Lead' },
  { value: 's1_ongoing', label: 'S1 Ongoing' },
  { value: 's2_sent', label: 'S2 Sent' },
  { value: 's3_technical_iteration', label: 'S3 Technical Iteration' },
  { value: 's4_negotiation', label: 'S4 Negotiation' },
  { value: 'closed_won', label: 'Closed won' },
  { value: 'closed_lost', label: 'Closed lost' },
];

export function OpportunityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, isError, error } = useOpportunity(id);
  const patch = usePatchOpportunity();
  const timeline = useOpportunityTimeline(id);
  const [briefOpen, setBriefOpen] = useState(false);
  const intel: IntelPayload = data?.intel ?? {};

  // Register contextual commands for this page in the global Cmd+K palette.
  // WHY: Twenty's command menu surfaces page-specific actions; we adapt the
  // pattern so the palette becomes a true action hub, not just navigation.
  const [taskOpen, setTaskOpen] = useState(false);
  useCommandContext(
    data
      ? [
          {
            id: 'opp-create-task',
            label: `Create task for ${data.name}`,
            hint: 'Add a to-do linked to this opportunity',
            onSelect: () => setTaskOpen(true),
          },
          {
            id: 'opp-open-briefing',
            label: `Open AI briefing for ${data.name}`,
            hint: 'Generate a Dust AI briefing document',
            onSelect: () => setBriefOpen(true),
          },
        ]
      : [],
  );

  if (isLoading) return <DetailPageSkeleton tabs columns={2} cards={3} />;
  if (isError)
    return <ErrorState title="Couldn't load this opportunity" message={error?.message ?? '—'} />;
  if (!data) {
    return (
      <EmptyState
        title="Opportunity not found"
        message="The opportunity may have been deleted or you may not have access to it."
        action={
          <Button variant="secondary" onClick={() => window.history.back()}>
            Go back
          </Button>
        }
      />
    );
  }

  const timelineItems =
    timeline.data?.items.map((t: { createdAt: string; kind: string; text: string }) => ({
      at: t.createdAt,
      kind: t.kind,
      text: t.text,
    })) ?? [];

  return (
    <div className="space-y-6">
      <GlassCard
        padding="lg"
        className="border-none bg-gradient-to-br from-[var(--surface-card)] to-[var(--surface-sunken-alpha)] shadow-2xl"
      >
        <header>
          <nav aria-label="Breadcrumb" className="text-xs text-[var(--fg-tertiary)] mb-4">
            <ol className="flex items-center gap-2">
              <li>
                <Link
                  to="/opportunities"
                  className="hover:text-[var(--brand-primary)] transition-colors"
                >
                  Opportunities
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
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0 flex-1">
              <h1 className="text-3xl font-bold tracking-tight text-[var(--fg-primary)] sm:text-4xl">
                <InlineEditText
                  value={data.name}
                  onSave={(v) => patch.mutateAsync({ id: id!, patch: { name: v } })}
                  label="Edit opportunity name"
                  validate={(v) => (v.length < 1 ? 'Name is required' : null)}
                />
              </h1>
              <div className="mt-2 flex items-center gap-2 text-sm text-[var(--fg-secondary)]">
                <span className="flex items-center gap-1.5 font-medium">
                  <Icon name="building" size={14} className="text-[var(--brand-primary)]" />
                  <InlineEditText
                    value={data.customer}
                    onSave={(v) => patch.mutateAsync({ id: id!, patch: { customer: v } })}
                    label="Edit customer name"
                    validate={(v) => (v.length < 1 ? 'Customer is required' : null)}
                  />
                </span>
                <span className="opacity-30">|</span>
                <span className="flex items-center gap-1.5">
                  <Icon name="reports" size={14} className="text-[var(--info)]" />
                  <InlineEditText
                    value={data.industry ?? ''}
                    onSave={(v) => patch.mutateAsync({ id: id!, patch: { industry: v || null } })}
                    label="Edit industry"
                    display={(v) => v || '—'}
                    placeholder="Industry"
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
                      + Task
                    </Button>
                  }
                />
                <Link to={`/rfp/${data.id}/pipeline`}>
                  <Button variant="ghost" size="sm" className="rounded-full">
                    <Icon name="wand" size={12} className="text-[var(--brand-primary)] mr-1" />
                    RFP Pipeline
                  </Button>
                </Link>
                <MagneticButton
                  onClick={() => setBriefOpen(true)}
                  className="h-8 px-4 text-xs shadow-none"
                >
                  Ask Dust
                </MagneticButton>
              </div>
              <InlineEditSelect<OpportunityStage>
                value={data.stage as OpportunityStage}
                onSave={(v) => patch.mutateAsync({ id: id!, patch: { stage: v } })}
                options={STAGE_OPTIONS}
                label="Change stage"
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
                    label="Edit deal value (EUR)"
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
                        label="Edit probability"
                        min={0}
                        max={100}
                        step={5}
                        suffix="%"
                      />
                    </span>
                    <span>likely</span>
                  </span>
                  <span className="opacity-30">·</span>
                  <span className="flex items-center gap-1">
                    <Icon name="clock" size={12} />
                    <InlineEditDate
                      value={data.dueDate}
                      onSave={(v) => patch.mutateAsync({ id: id!, patch: { dueDate: v } })}
                      label="Edit due date"
                      display={(v) => formatDate(v)}
                    />
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

      <DataFreshnessRibbon refreshedAt={intel.refreshedAt} />

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
        timeline={timelineItems}
      />

      <CustomFieldValuesSection entityType="opportunity" entityId={id!} />

      {/* Wave 8 — Collaborative scratch-pad: real-time CRDT rich-text. */}
      <CollaborativeNotesSection
        entityType="opportunity"
        entityId={id}
        fieldKey="notes"
        label="Live collaboration"
      />

      {/* Controlled CreateTaskDialog driven by the command palette (A3). */}
      <CreateTaskDialog oppId={data.id} open={taskOpen} onOpenChange={setTaskOpen} />
    </div>
  );
}

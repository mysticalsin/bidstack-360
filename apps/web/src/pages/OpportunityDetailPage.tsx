import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';

import { Badge, stageTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { BriefingDialog } from '@/components/opportunity/BriefingDialog';
import {
  InlineEditDate,
  InlineEditNumber,
  InlineEditSelect,
  InlineEditText,
} from '@/components/opportunity/InlineEdit';
import { OpportunityTabs } from '@/components/opportunity/OpportunityTabs';
import { CreateTaskDialog } from '@/components/task/CreateTaskDialog';
import { usePatchOpportunity, useOpportunity } from '@/hooks/useOpportunities';
import { formatDate, formatMoney, formatStage } from '@/lib/format';

import type { OpportunityStage } from '@bidstack/shared';

const STAGE_OPTIONS: ReadonlyArray<{ value: OpportunityStage; label: string }> = [
  { value: 'discovery', label: 'Discovery' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'proposal', label: 'Proposal' },
  { value: 'negotiation', label: 'Negotiation' },
  { value: 'closed_won', label: 'Closed won' },
  { value: 'closed_lost', label: 'Closed lost' },
];

interface IntelPayload {
  refreshedAt?: string;
  financial?: {
    ticker: string | null;
    marketCap: number | null;
    revenueAnnual: number | null;
    revenueGrowth: number | null;
    ebitdaMargin: number | null;
    creditRating: string | null;
    headcount: number | null;
    pricePoints?: number[];
  } | null;
  triggers?: Array<{
    id: string;
    label: string;
    weight: number;
    observedAt: string;
    source: string | null;
    kind: string;
  }>;
  competitors?: Array<{ vendor: string; score: number; strengths: string[]; weaknesses: string[] }>;
  news?: Array<{
    id: string;
    headline: string;
    source: string;
    publishedAt: string;
    sentiment: string;
  }>;
  hiring?: { openings: Array<{ title: string; urgency: string }>; trendDirection: string };
  winPrediction?: {
    probability: number;
    modelVersion: string;
    drivers: Array<{ label: string; contribution: number }>;
  };
  decisionUnit?: Array<{
    contactId: string;
    name: string;
    role: string;
    influence: number;
    sentiment: 'hot' | 'warm' | 'neutral' | 'cold';
    power: 'decision' | 'champion' | 'influencer' | 'gatekeeper' | 'approver';
  }>;
}

export function OpportunityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, isError, error } = useOpportunity(id);
  const patch = usePatchOpportunity(id);
  const [briefOpen, setBriefOpen] = useState(false);
  const intel = (data?.intel ?? {}) as IntelPayload;

  if (isLoading) return <LoadingSkeleton rows={8} />;
  if (isError)
    return <ErrorState title="Couldn't load this opportunity" message={error?.message ?? '—'} />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <header>
        <nav aria-label="Breadcrumb" className="text-xs text-[var(--fg-tertiary)] mb-2">
          <ol className="flex items-center gap-2">
            <li>
              <Link to="/opportunities" className="hover:text-[var(--brand-primary)]">
                Opportunities
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li aria-current="page">{data.code}</li>
          </ol>
        </nav>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold tracking-tight text-[var(--fg-primary)]">
              <InlineEditText
                value={data.name}
                onSave={(v) => patch.mutateAsync({ name: v })}
                label="Edit opportunity name"
                validate={(v) => (v.length < 1 ? 'Name is required' : null)}
              />
            </h1>
            <p className="mt-1 text-sm text-[var(--fg-secondary)]">
              <InlineEditText
                value={data.customer}
                onSave={(v) => patch.mutateAsync({ customer: v })}
                label="Edit customer name"
                validate={(v) => (v.length < 1 ? 'Customer is required' : null)}
              />
              {' · '}
              <InlineEditText
                value={data.industry ?? ''}
                onSave={(v) => patch.mutateAsync({ industry: v || null })}
                label="Edit industry"
                display={(v) => v || '—'}
                placeholder="Industry"
              />
            </p>
          </div>
          <div className="flex items-center gap-3">
            <CreateTaskDialog
              oppId={data.id}
              trigger={
                <Button variant="secondary" size="sm">
                  + Task
                </Button>
              }
            />
            <Button size="sm" onClick={() => setBriefOpen(true)}>
              Ask Dust
            </Button>
            <InlineEditSelect<OpportunityStage>
              value={data.stage as OpportunityStage}
              onSave={(v) => patch.mutateAsync({ stage: v })}
              options={STAGE_OPTIONS}
              label="Change stage"
              display={(v) => <Badge tone={stageTone(v)}>{formatStage(v)}</Badge>}
            />
            <div className="text-right">
              <div className="text-2xl font-bold tabular-nums text-[var(--fg-primary)]">
                <InlineEditNumber
                  value={data.value}
                  onSave={(v) => patch.mutateAsync({ value: v })}
                  label="Edit deal value (EUR)"
                  min={0}
                  step={1000}
                  display={(v) => formatMoney(v, 'EUR')}
                />
              </div>
              <div className="text-xs text-[var(--fg-tertiary)]">
                <InlineEditNumber
                  value={data.probability}
                  onSave={(v) => patch.mutateAsync({ probability: v })}
                  label="Edit probability"
                  min={0}
                  max={100}
                  step={5}
                  suffix="%"
                />
                {' likely · due '}
                <InlineEditDate
                  value={data.dueDate}
                  onSave={(v) => patch.mutateAsync({ dueDate: v })}
                  label="Edit due date"
                  display={(v) => formatDate(v)}
                />
              </div>
            </div>
          </div>
        </div>
      </header>

      <BriefingDialog
        opportunityId={data.id}
        opportunityLabel={data.name}
        open={briefOpen}
        onOpenChange={setBriefOpen}
      />

      <DataFreshnessRibbon refreshedAt={intel.refreshedAt} />

      <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
        <FinancialHealthCard intel={intel} />
        <WinPredictionCard intel={intel} />
        <HiringCard intel={intel} />
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
      />
    </div>
  );
}

function DataFreshnessRibbon({ refreshedAt }: { refreshedAt?: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-[var(--fg-tertiary)]">
      <span
        className="inline-block h-2 w-2 rounded-full bg-[var(--success)] animate-pulse"
        aria-hidden
      />
      <span>
        Intel refreshed {refreshedAt ? formatDate(refreshedAt) : '—'} · Sources: Crunchbase,
        LinkedIn, EU register
      </span>
    </div>
  );
}

function FinancialHealthCard({ intel }: { intel: IntelPayload }) {
  const f = intel.financial;
  return (
    <Card>
      <SectionHeader title="Financial health" caption={f?.ticker ?? 'Private'} />
      <div className="p-5 space-y-3 text-sm">
        <Row label="Market cap" value={f?.marketCap ? formatMoney(f.marketCap, 'USD') : '—'} />
        <Row
          label="Revenue (TTM)"
          value={f?.revenueAnnual ? formatMoney(f.revenueAnnual, 'USD') : '—'}
        />
        <Row
          label="Growth"
          value={f?.revenueGrowth != null ? `${(f.revenueGrowth * 100).toFixed(1)}%` : '—'}
        />
        <Row
          label="EBITDA margin"
          value={f?.ebitdaMargin != null ? `${(f.ebitdaMargin * 100).toFixed(1)}%` : '—'}
        />
        <Row label="Credit rating" value={f?.creditRating ?? '—'} />
        <Row label="Headcount" value={f?.headcount?.toLocaleString() ?? '—'} />
      </div>
    </Card>
  );
}

function WinPredictionCard({ intel }: { intel: IntelPayload }) {
  const wp = intel.winPrediction;
  if (!wp)
    return (
      <Card>
        <SectionHeader title="Win prediction" />
        <div className="p-5 text-xs text-[var(--fg-tertiary)]">No prediction available.</div>
      </Card>
    );
  return (
    <Card>
      <SectionHeader title="Win prediction" caption={`Model ${wp.modelVersion}`} />
      <div className="p-5 space-y-3">
        <div className="flex items-baseline gap-2">
          <div className="text-4xl font-bold tabular-nums text-[var(--fg-primary)]">
            {wp.probability}%
          </div>
          <div className="text-xs text-[var(--fg-tertiary)]">probability</div>
        </div>
        <ul className="space-y-1.5">
          {wp.drivers.map((d) => (
            <li key={d.label} className="flex items-center justify-between text-xs">
              <span className="text-[var(--fg-secondary)]">{d.label}</span>
              <span
                className={`tabular-nums font-medium ${d.contribution >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}
              >
                {d.contribution > 0 ? '+' : ''}
                {d.contribution}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function HiringCard({ intel }: { intel: IntelPayload }) {
  const h = intel.hiring;
  return (
    <Card>
      <SectionHeader title="Hiring signals" caption={h ? `Trend ${h.trendDirection}` : ''} />
      <div className="p-5 space-y-2">
        {h?.openings?.length ? (
          h.openings.map((o, i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <span className="text-[var(--fg-primary)]">{o.title}</span>
              <Badge
                tone={o.urgency === 'high' ? 'tomato' : o.urgency === 'medium' ? 'amber' : 'gray'}
              >
                {o.urgency}
              </Badge>
            </div>
          ))
        ) : (
          <p className="text-xs text-[var(--fg-tertiary)]">No active job postings tracked.</p>
        )}
      </div>
    </Card>
  );
}

function TriggersCard({ intel }: { intel: IntelPayload }) {
  return (
    <Card>
      <SectionHeader title="Buying triggers" caption="Weighted signals" />
      <ul className="divide-y divide-[var(--border-subtle)]">
        {(intel.triggers ?? []).map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-3">
            <div className="min-w-0">
              <div className="text-sm text-[var(--fg-primary)]">{t.label}</div>
              <div className="text-xs text-[var(--fg-tertiary)]">
                {t.kind} · {t.source ?? 'unknown'} · {formatDate(t.observedAt)}
              </div>
            </div>
            <div
              className="rounded-md bg-[var(--brand-primary-tint)] px-2 py-1 text-xs font-semibold text-[var(--brand-primary)] tabular-nums"
              aria-label={`Weight ${t.weight}/10`}
            >
              {t.weight}/10
            </div>
          </li>
        ))}
        {!intel.triggers?.length ? (
          <li className="px-5 py-6 text-xs text-[var(--fg-tertiary)]">No triggers detected yet.</li>
        ) : null}
      </ul>
    </Card>
  );
}

function CompetitorRadarCard({ intel }: { intel: IntelPayload }) {
  return (
    <Card>
      <SectionHeader title="Competitor landscape" />
      <ul className="divide-y divide-[var(--border-subtle)]">
        {(intel.competitors ?? []).map((c) => (
          <li key={c.vendor} className="px-5 py-3">
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-sm font-medium text-[var(--fg-primary)]">{c.vendor}</div>
              <div className="text-xs tabular-nums text-[var(--fg-tertiary)]">{c.score}/100</div>
            </div>
            <div className="h-1.5 rounded-full bg-[var(--surface-sunken)] overflow-hidden">
              <div className="h-full bg-[var(--brand-primary)]" style={{ width: `${c.score}%` }} />
            </div>
            <div className="mt-1.5 text-xs text-[var(--fg-tertiary)]">
              + {c.strengths.join(', ') || '—'} · − {c.weaknesses.join(', ') || '—'}
            </div>
          </li>
        ))}
        {!intel.competitors?.length ? (
          <li className="px-5 py-6 text-xs text-[var(--fg-tertiary)]">No competitors mapped.</li>
        ) : null}
      </ul>
    </Card>
  );
}

function NewsCard({ intel }: { intel: IntelPayload }) {
  return (
    <Card>
      <SectionHeader title="Recent news" />
      <ul className="divide-y divide-[var(--border-subtle)]">
        {(intel.news ?? []).map((n) => (
          <li key={n.id} className="px-5 py-3">
            <div className="flex items-center justify-between">
              <div className="text-sm text-[var(--fg-primary)]">{n.headline}</div>
              <Badge
                tone={
                  n.sentiment === 'positive'
                    ? 'jade'
                    : n.sentiment === 'negative'
                      ? 'tomato'
                      : 'gray'
                }
              >
                {n.sentiment}
              </Badge>
            </div>
            <div className="text-xs text-[var(--fg-tertiary)]">
              {n.source} · {formatDate(n.publishedAt)}
            </div>
          </li>
        ))}
        {!intel.news?.length ? (
          <li className="px-5 py-6 text-xs text-[var(--fg-tertiary)]">No news pulled.</li>
        ) : null}
      </ul>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-[var(--fg-tertiary)]">{label}</span>
      <span className="font-medium text-[var(--fg-primary)] tabular-nums">{value}</span>
    </div>
  );
}

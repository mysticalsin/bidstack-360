// Sprint 1 — RFP / Bid Response hub page.
// Dedicated landing surface that aggregates the bid-response workflow:
// Bid/No-Bid qualification, proposals in flight, recent bid scores, and
// the AI agent context. Lives at /rfp-response and is the centrepiece of
// the "RFP / Bid Response" sidebar section.

import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Card } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { LiquidGlassButton } from '@/components/ui/LiquidGlassButton';
import { EmptyState } from '@/components/ui/StateMessages';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { api } from '@/lib/api';
import { useOpportunityCount } from '@/hooks/useOpportunities';
import {
  ProposalStatusChip,
  type ProposalStatus,
} from '@/components/rfp/shared/ProposalStatusChip';

interface Proposal {
  id: string;
  orgId: string;
  opportunityId: string | null;
  name: string;
  status: ProposalStatus;
  version: number;
  ownerId: string | null;
  complianceScore: number | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}
interface ProposalPage {
  items: Proposal[];
  total: number;
}

interface BidScore {
  id: string;
  opportunityId: string;
  totalScore: number;
  recommendation: 'bid' | 'no_bid' | 'review';
  createdAt: string;
}
interface BidScoreList {
  items: BidScore[];
}

const REC_TONE: Record<BidScore['recommendation'], string> = {
  bid: 'bg-[var(--tag-jade-bg)] text-[var(--tag-jade-fg)]',
  no_bid: 'bg-[var(--tag-tomato-bg)] text-[var(--tag-tomato-fg)]',
  review: 'bg-[var(--tag-amber-bg)] text-[var(--tag-amber-fg)]',
};

export function RfpResponseHubPage() {
  useDocumentTitle();
  const navigate = useNavigate();
  const { t } = useTranslation('common');

  const openOpps = useOpportunityCount({ excludeClosed: true });

  const proposals = useQuery<ProposalPage>({
    queryKey: ['rfp-hub', 'proposals'],
    queryFn: ({ signal }) => api<ProposalPage>('/api/v1/proposals?limit=10', { signal }),
  });

  // Bid scores list — surfaces "should we bid or not" decisions. The
  // endpoint returns the most recent first; we slice the top 5 here.
  const bidScores = useQuery<BidScoreList>({
    queryKey: ['rfp-hub', 'bid-scores'],
    queryFn: ({ signal }) => api<BidScoreList>('/api/v1/bid-scores?limit=10', { signal }),
  });

  const inFlight = useMemo(
    () =>
      (proposals.data?.items ?? []).filter((p) =>
        ['draft', 'review', 'approved', 'submitted'].includes(p.status),
      ),
    [proposals.data?.items],
  );
  const completed = useMemo(
    () => (proposals.data?.items ?? []).filter((p) => p.status === 'won' || p.status === 'lost'),
    [proposals.data?.items],
  );
  const won = completed.filter((p) => p.status === 'won').length;
  const winRate = completed.length > 0 ? Math.round((won / completed.length) * 100) : null;

  const avgScore = bidScores.data?.items?.length
    ? Math.round(
        bidScores.data.items.reduce((acc, s) => acc + s.totalScore, 0) /
          bidScores.data.items.length,
      )
    : null;

  return (
    <div className="space-y-6">
      <header className="page-head">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--brand-primary)]">
            {t('nav.rfpSection')}
          </p>
          <h1 className="page-title">{t('pages.rfpHub.title')}</h1>
          <p className="page-sub">{t('pages.rfpHub.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <LiquidGlassButton
            tone="secondary"
            size="sm"
            onClick={() => navigate('/bid-matrix')}
            aria-label={t('pages.rfpHub.proposals.openMatrix')}
          >
            <Icon name="target" size={14} />
            {t('pages.rfpHub.actions.bidNoBid')}
          </LiquidGlassButton>
          <LiquidGlassButton size="sm" onClick={() => navigate('/proposals?new=1')}>
            <Icon name="plus" size={14} />
            {t('pages.rfpHub.actions.newProposal')}
          </LiquidGlassButton>
        </div>
      </header>

      {/* KPI strip */}
      <section aria-label="RFP key metrics" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile
          label={t('pages.rfpHub.kpi.proposalsInFlight')}
          value={proposals.isLoading ? '…' : inFlight.length.toString()}
          detail={t('pages.rfpHub.kpi.proposalsDetail')}
          icon="briefcase"
        />
        <KpiTile
          label={t('pages.rfpHub.kpi.openOpps')}
          value={openOpps.isLoading ? '…' : (openOpps.data?.count ?? 0).toString()}
          detail={t('pages.rfpHub.kpi.openOppsDetail')}
          icon="pipeline"
        />
        <KpiTile
          label={t('pages.rfpHub.kpi.avgScore')}
          value={avgScore === null ? '—' : `${avgScore}`}
          detail={`across ${bidScores.data?.items?.length ?? 0} most-recent scores`}
          icon="target"
        />
        <KpiTile
          label={t('pages.rfpHub.kpi.winRate')}
          value={winRate === null ? '—' : `${winRate}%`}
          detail={`${won} won · ${completed.length} closed`}
          icon="trophy"
        />
      </section>

      {/* Two-column main body */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Proposals in flight (2/3 width on lg) */}
        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-2">
            <div>
              <h2 className="text-sm font-semibold text-[var(--fg-primary)]">
                {t('pages.rfpHub.proposals.heading')}
              </h2>
              <p className="mt-0.5 text-xs text-[var(--fg-tertiary)]">
                {t('pages.rfpHub.proposals.caption')}
              </p>
            </div>
            <Link
              to="/proposals"
              className="text-xs font-medium text-[var(--brand-primary)] hover:underline"
            >
              {t('pages.rfpHub.proposals.viewAll')}
            </Link>
          </div>
          {proposals.isLoading ? (
            <div className="p-6 text-sm text-[var(--fg-secondary)]">{t('states.loading')}</div>
          ) : proposals.isError ? (
            <div className="p-6 text-sm text-red-600 dark:text-red-400" role="alert">
              {t('states.error')}
            </div>
          ) : inFlight.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={t('pages.rfpHub.proposals.emptyTitle')}
                message={t('pages.rfpHub.proposals.emptyMessage')}
                action={
                  <Button onClick={() => navigate('/bid-matrix')}>
                    {t('pages.rfpHub.proposals.openMatrix')}
                  </Button>
                }
              />
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {inFlight.slice(0, 8).map((p) => (
                <li key={p.id}>
                  <Link
                    to={`/proposals/${p.id}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface-sunken)]"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-sm font-medium text-[var(--fg-primary)]">
                        {p.name}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[var(--fg-tertiary)]">
                        <ProposalStatusChip status={p.status} />
                        <span>v{p.version}</span>
                        {p.complianceScore !== null ? (
                          <span title="Compliance score">· {p.complianceScore}% compliant</span>
                        ) : null}
                        {p.dueDate ? (
                          <span>· Due {new Date(p.dueDate).toLocaleDateString()}</span>
                        ) : null}
                      </div>
                    </div>
                    <Icon name="arrow" size={14} ariaHidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Recent bid scores (1/3 width on lg) */}
        <Card>
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-2">
            <h2 className="text-sm font-semibold text-[var(--fg-primary)]">
              {t('pages.rfpHub.bidScores.heading')}
            </h2>
            <Link
              to="/bid-matrix"
              className="text-xs font-medium text-[var(--brand-primary)] hover:underline"
            >
              {t('pages.rfpHub.bidScores.matrixLink')}
            </Link>
          </div>
          {bidScores.isLoading ? (
            <div className="p-6 text-sm text-[var(--fg-secondary)]">{t('states.loading')}</div>
          ) : bidScores.isError ? (
            <div className="p-6 text-sm text-red-600 dark:text-red-400" role="alert">
              {t('states.error')}
            </div>
          ) : !bidScores.data?.items?.length ? (
            <div className="p-6">
              <EmptyState
                title={t('pages.rfpHub.bidScores.emptyTitle')}
                message={t('pages.rfpHub.bidScores.emptyMessage')}
              />
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {bidScores.data.items.slice(0, 6).map((s) => (
                <li key={s.id}>
                  <Link
                    to={`/opportunities/${s.opportunityId}`}
                    className="flex items-center gap-2 px-4 py-2.5 hover:bg-[var(--surface-sunken)]"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-mono text-xs text-[var(--fg-tertiary)]">
                        opp · {s.opportunityId.slice(0, 8)}
                      </div>
                      <div className="mt-0.5 text-sm font-semibold text-[var(--fg-primary)]">
                        Score {s.totalScore}
                      </div>
                    </div>
                    <span
                      className={`inline-flex h-5 items-center rounded-full px-2 text-[10px] font-semibold ${REC_TONE[s.recommendation]}`}
                    >
                      {s.recommendation.replace('_', '-').toUpperCase()}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* AI agents row */}
      <Card>
        <div className="border-b border-[var(--border-subtle)] px-4 py-2">
          <h2 className="text-sm font-semibold text-[var(--fg-primary)]">
            {t('pages.rfpHub.agents.heading')}
          </h2>
          <p className="mt-0.5 text-xs text-[var(--fg-tertiary)]">
            {t('pages.rfpHub.agents.caption')}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <AgentTile
            icon="target"
            title={t('pages.rfpHub.agents.qualifier.title')}
            description={t('pages.rfpHub.agents.qualifier.description')}
            cta={t('pages.rfpHub.agents.qualifier.cta')}
            to="/bid-matrix"
          />
          <AgentTile
            icon="sparkle"
            title={t('pages.rfpHub.agents.drafter.title')}
            description={t('pages.rfpHub.agents.drafter.description')}
            cta={t('pages.rfpHub.agents.drafter.cta')}
            to="/proposals"
          />
          <AgentTile
            icon="shield"
            title={t('pages.rfpHub.agents.compliance.title')}
            description={t('pages.rfpHub.agents.compliance.description')}
            cta={t('pages.rfpHub.agents.compliance.cta')}
            to="/agents"
          />
          <AgentTile
            icon="trophy"
            title={t('pages.rfpHub.agents.winLoss.title')}
            description={t('pages.rfpHub.agents.winLoss.description')}
            cta={t('pages.rfpHub.agents.winLoss.cta')}
            to="/reports"
          />
        </div>
      </Card>
    </div>
  );
}

function KpiTile({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: IconName;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
          {label}
        </span>
        <Icon name={icon} size={14} ariaHidden />
      </div>
      <div className="mt-1.5 text-2xl font-bold tracking-tight text-[var(--fg-primary)]">
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-[var(--fg-tertiary)]">{detail}</div>
    </Card>
  );
}

function AgentTile({
  icon,
  title,
  description,
  cta,
  to,
}: {
  icon: IconName;
  title: string;
  description: string;
  cta: string;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="group flex flex-col gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-3 hover:border-[var(--brand-primary)] hover:bg-[var(--surface-sunken)]"
    >
      <div className="flex items-center gap-2">
        <span
          className="grid h-8 w-8 place-items-center rounded-lg"
          style={{
            background: 'linear-gradient(135deg, #B49CFF 0%, #7C3AED 100%)',
            color: 'white',
          }}
        >
          <Icon name={icon} size={16} ariaHidden />
        </span>
        <span className="text-sm font-semibold text-[var(--fg-primary)]">{title}</span>
      </div>
      <p className="text-xs leading-relaxed text-[var(--fg-secondary)]">{description}</p>
      <div className="mt-auto inline-flex items-center gap-1 text-xs font-medium text-[var(--brand-primary)] group-hover:underline">
        {cta}
        <Icon name="arrow" size={12} ariaHidden />
      </div>
    </Link>
  );
}

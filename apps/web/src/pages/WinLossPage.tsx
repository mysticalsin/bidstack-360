/**
 * Win/Loss review — the retrospective a bid director opens every quarter.
 * Answers, in order: what is our win rate (and which way is it trending),
 * which quarters won/lost, WHY are we losing (reason Pareto + competitor),
 * and which closed bids to debrief next. Data: GET /win-loss/analysis.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ChartContainer } from '@/components/charts/ChartContainer';
import { KpiCard } from '@/components/charts/KpiCard';
import { BarChart, FunnelChart } from '@/components/charts/charts';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select, type SelectOption } from '@/components/ui/Select';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useUsers } from '@/hooks/useUsers';
import { REASON_LABELS } from '@/pages/winLoss/reasonLabels';
import { WinLossRecentTable } from '@/pages/winLoss/WinLossRecentTable';
import {
  useWinLossAnalysis,
  type WinLossAnalysis,
  type WinLossAnalysisFilter,
} from '@/pages/winLoss/useWinLossAnalysis';

// Module-level formatters: a stable reference keeps KpiCard's count-up effect
// from replaying on every parent re-render (e.g. while typing a filter date).
const formatOneDecimal = (n: number) => n.toFixed(1);
const formatWhole = (n: number) => Math.round(n).toLocaleString();

function quarterWinRates(data: WinLossAnalysis | undefined): number[] {
  return (data?.quarters ?? []).map((q) => {
    const total = q.won + q.lost;
    return total === 0 ? 0 : (q.won / total) * 100;
  });
}

export default function WinLossPage() {
  const { t } = useTranslation('crm');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [ownerId, setOwnerId] = useState('');

  const filter = useMemo<WinLossAnalysisFilter>(
    () => ({
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(ownerId ? { ownerId } : {}),
    }),
    [from, to, ownerId],
  );
  const analysis = useWinLossAnalysis(filter);
  const users = useUsers({ limit: 200 });

  const data = analysis.data;
  const rates = useMemo(() => quarterWinRates(data), [data]);
  // Trend vs the previous quarter — only meaningful with two buckets.
  const winRateDelta =
    rates.length >= 2 ? rates[rates.length - 1]! - rates[rates.length - 2]! : undefined;

  const lossReasons = useMemo(
    () =>
      (data?.reasons ?? [])
        .filter((r) => r.lost > 0)
        .map((r) => ({
          name: t(REASON_LABELS[r.reason].key, REASON_LABELS[r.reason].label),
          value: r.lost,
        })),
    [data?.reasons, t],
  );
  const competitorLosses = useMemo(
    () =>
      (data?.competitors ?? [])
        .filter((c) => c.lost > 0)
        .map((c) => ({ name: c.competitor, value: c.lost })),
    [data?.competitors],
  );

  const ownerOptions = useMemo<SelectOption[]>(
    () => [
      { value: '', label: t('winLoss.allOwners', 'All owners') },
      ...(users.data ?? []).map((u) => ({ value: u.id, label: u.name ?? u.email })),
    ],
    [users.data, t],
  );

  const hasFilters = Boolean(from || to || ownerId);
  const clearFilters = () => {
    setFrom('');
    setTo('');
    setOwnerId('');
  };
  const isEmpty = Boolean(data && data.totalWon + data.totalLost === 0);

  return (
    <div className="space-y-5">
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('winLoss.title', 'Win/Loss review')}</h1>
          <div className="page-sub">
            {t(
              'winLoss.subtitle',
              'Quarterly retrospective on closed bids — where we win, why we lose, and which deals to debrief.',
            )}
          </div>
        </div>
      </div>

      <div
        className="flex flex-wrap items-end gap-3"
        role="group"
        aria-label={t('winLoss.filtersLabel', 'Filter win/loss analysis')}
      >
        <Input
          type="date"
          label={t('winLoss.fromLabel', 'Recorded from')}
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="w-44"
        />
        <Input
          type="date"
          label={t('winLoss.toLabel', 'Recorded to')}
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="w-44"
        />
        <Select
          label={t('winLoss.ownerLabel', 'Owner')}
          value={ownerId}
          onChange={(e) => setOwnerId(e.target.value)}
          options={ownerOptions}
          isLoading={users.isLoading}
          className="w-56"
        />
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            {t('winLoss.clearFilters', 'Clear filters')}
          </Button>
        )}
      </div>

      {analysis.isLoading ? (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <KpiCard title="" value={0} loading />
            <KpiCard title="" value={0} loading />
            <KpiCard title="" value={0} loading />
          </div>
          <ChartContainer loading title={t('winLoss.quarterChartTitle', 'Wins vs losses by quarter')}>
            <div />
          </ChartContainer>
          <LoadingSkeleton rows={5} />
        </>
      ) : analysis.isError ? (
        <ErrorState
          title={t('winLoss.errorTitle', 'Could not load the win/loss analysis')}
          message={analysis.error?.message ?? t('winLoss.errorMessage', 'Try again shortly.')}
          action={
            <Button variant="secondary" size="sm" onClick={() => void analysis.refetch()}>
              {t('winLoss.retry', 'Retry')}
            </Button>
          }
        />
      ) : isEmpty || !data ? (
        <EmptyState
          title={t('winLoss.emptyTitle', 'No closed bids in this range yet')}
          message={t(
            'winLoss.emptyMessage',
            'Outcomes appear here once a won or lost reason is recorded on an opportunity.',
          )}
          action={
            hasFilters ? (
              <Button variant="secondary" size="sm" onClick={clearFilters}>
                {t('winLoss.clearFilters', 'Clear filters')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <KpiCard
              title={t('winLoss.kpiWinRate', 'Win rate')}
              value={data.winRatePct ?? 0}
              unit="%"
              deltaPercent={winRateDelta}
              deltaPeriod={t('winLoss.vsPrevQuarter', 'vs previous quarter')}
              sparklineData={rates.length > 1 ? rates : undefined}
              format={formatOneDecimal}
            />
            <KpiCard
              title={t('winLoss.kpiWon', 'Bids won')}
              value={data.totalWon}
              format={formatWhole}
            />
            <KpiCard
              title={t('winLoss.kpiLost', 'Bids lost')}
              value={data.totalLost}
              format={formatWhole}
            />
          </div>

          <ChartContainer
            title={t('winLoss.quarterChartTitle', 'Wins vs losses by quarter')}
            subtitle={t('winLoss.quarterChartSubtitle', 'Bucketed by when the outcome was recorded')}
            empty={data.quarters.length === 0}
          >
            <div data-testid="win-loss-quarter-chart">
              <BarChart
                data={data.quarters}
                xKey="quarter"
                yKey={['won', 'lost']}
                aria-label={t('winLoss.quarterChartAria', 'Wins and losses per quarter')}
              />
            </div>
          </ChartContainer>

          <div className="grid gap-5 lg:grid-cols-2">
            <ChartContainer
              title={t('winLoss.reasonChartTitle', 'Loss reasons')}
              subtitle={t('winLoss.reasonChartSubtitle', 'Pareto of recorded lost bids')}
              empty={lossReasons.length === 0}
              emptyMessage={t('winLoss.noLosses', 'No recorded losses in this range.')}
            >
              <div data-testid="win-loss-reason-chart">
                <FunnelChart
                  data={lossReasons}
                  aria-label={t('winLoss.reasonChartAria', 'Lost bids per reason')}
                />
              </div>
            </ChartContainer>
            <ChartContainer
              title={t('winLoss.competitorChartTitle', 'Losses by competitor')}
              subtitle={t('winLoss.competitorChartSubtitle', 'Who is taking the deals we lose')}
              empty={competitorLosses.length === 0}
              emptyMessage={t(
                'winLoss.noCompetitors',
                'No competitor recorded on lost bids in this range.',
              )}
            >
              <div data-testid="win-loss-competitor-chart">
                <FunnelChart
                  data={competitorLosses}
                  aria-label={t('winLoss.competitorChartAria', 'Lost bids per competitor')}
                />
              </div>
            </ChartContainer>
          </div>

          <WinLossRecentTable rows={data.recent} />
        </>
      )}
    </div>
  );
}

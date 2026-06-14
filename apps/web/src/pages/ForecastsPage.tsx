/**
 * ForecastsPage — lean orchestrator.
 * Owns: data fetching, mutations, derived state, page-level callbacks.
 * Delegates rendering to: ForecastChart, ForecastList, NewForecastDialogContent.
 */
import { useMemo, useState, useCallback } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Dialog, DialogTrigger } from '@/components/ui/Dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { Icon } from '@/components/ui/Icon';
import { toast } from '@/components/ui/Toast';
import { confirm } from '@/components/ui/ConfirmDialog';
import { useForecasts, useCreateForecast, useDeleteForecast } from '@/hooks/useForecasts';
import { useUsers } from '@/hooks/useUsers';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { staggerChild, staggerParent } from '@/lib/motion';
import type { Forecast } from '@bidstack/shared';

import { ForecastChart } from './forecasts/ForecastChart';
import { ForecastList } from './forecasts/ForecastList';
import { NewForecastDialogContent } from './forecasts/NewForecastDialog';
import {
  buildChartData,
  groupForecasts,
  matchesPeriodFilter,
  type ForecastRow,
  type PeriodFilter,
} from './forecasts/forecastsConfig';

export function ForecastsPage() {
  const { t } = useTranslation('crm');
  const { formatMoneyMicros } = useFormatMoney();
  const reducedMotion = useReducedMotion();
  const forecasts = useForecasts();
  const users = useUsers();
  const createForecast = useCreateForecast();
  const deleteForecast = useDeleteForecast();

  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('monthly');
  const [dialogOpen, setDialogOpen] = useState(false);

  const filteredItems = useMemo(() => {
    const items = forecasts.data?.items ?? [];
    return items.filter((i) => matchesPeriodFilter(i.period, periodFilter));
  }, [forecasts.data, periodFilter]);

  const rows = useMemo(() => groupForecasts(filteredItems), [filteredItems]);
  const chartData = useMemo(() => buildChartData(rows), [rows]);
  const maxTotal = useMemo(
    () =>
      chartData.length === 0
        ? 0
        : Math.max(...chartData.map((d) => d.pipeline + d.bestCase + d.commit + d.closed)),
    [chartData],
  );

  // Headline totals for the selected period — so the page answers "what's the
  // number?" in one glance, led by Commit (the figure the bid team is held to).
  const totals = useMemo(() => {
    const t = { pipeline: 0, best_case: 0, commit: 0, closed: 0 };
    for (const item of filteredItems) t[item.category] += item.amountMicros;
    return t;
  }, [filteredItems]);

  // ownerId identifies the row being edited — the grid shows every owner's
  // forecasts, so the write MUST carry it through or it silently overwrites the
  // signed-in user's own row instead.
  const handleSaveCell = useCallback(
    async (ownerId: string, period: string, category: Forecast['category'], micros: number) => {
      try {
        await createForecast.mutateAsync({
          ownerId,
          period,
          category,
          amountMicros: micros,
          currency: 'EUR',
        });
        toast.success(t('forecasts.toastUpdated', 'Forecast updated'));
      } catch (err) {
        toast.error(t('forecasts.toastUpdateFailed', 'Failed to update forecast'), {
          description: err instanceof Error ? err.message : t('forecasts.unknownError', 'Unknown error'),
        });
      }
    },
    [createForecast],
  );

  const handleDeleteRow = useCallback(
    async (row: ForecastRow) => {
      const ids = Object.values(row.ids).filter(Boolean) as string[];
      if (ids.length === 0) return;
      if (
        await confirm({
          title: t('forecasts.deleteConfirmTitle', 'Delete forecasts for {{period}}?', {
            period: row.period,
          }),
          description: t(
            'forecasts.deleteConfirmDescription',
            'This will remove all category forecasts for this period and owner.',
          ),
          destructive: true,
        })
      ) {
        try {
          await Promise.all(ids.map((id) => deleteForecast.mutateAsync(id)));
          toast.success(t('forecasts.toastDeleted', 'Forecasts deleted'));
        } catch (err) {
          toast.error(t('forecasts.toastDeleteFailed', 'Failed to delete forecasts'), {
            description: err instanceof Error ? err.message : t('forecasts.unknownError', 'Unknown error'),
          });
        }
      }
    },
    [deleteForecast],
  );

  return (
    <motion.div
      className="space-y-6"
      variants={reducedMotion ? undefined : staggerParent}
      initial={reducedMotion ? false : 'initial'}
      animate="animate"
    >
      {/* ── Header ── */}
      <motion.header
        variants={reducedMotion ? undefined : staggerChild}
        className="flex flex-wrap items-end justify-between gap-3"
      >
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">
            {t('forecasts.title', 'Revenue Forecasts')}
          </h1>
          <p className="mt-1 text-sm text-[var(--fg-secondary)]">
            {t(
              'forecasts.subtitle',
              "Will the bids we're piloting hit the number? Pipeline, best case, commit, and closed by period.",
            )}
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Icon name="plus" size={14} /> {t('forecasts.newForecast', 'New Forecast')}
            </Button>
          </DialogTrigger>
          <NewForecastDialogContent
            users={users.data ?? []}
            onClose={() => setDialogOpen(false)}
            onSubmit={async (body) => {
              try {
                const entries = Object.entries(body.amounts) as [Forecast['category'], number][];
                await Promise.all(
                  entries
                    .filter(([, amount]) => amount > 0)
                    .map(([category, amount]) =>
                      createForecast.mutateAsync({
                        ownerId: body.ownerId,
                        period: body.period,
                        category,
                        amountMicros: amount,
                        currency: 'EUR',
                      }),
                    ),
                );
                toast.success(t('forecasts.toastCreated', 'Forecast created'));
                setDialogOpen(false);
              } catch (err) {
                toast.error(t('forecasts.toastCreateFailed', 'Failed to create forecast'), {
                  description: err instanceof Error ? err.message : t('forecasts.unknownError', 'Unknown error'),
                });
              }
            }}
            isPending={createForecast.isPending}
          />
        </Dialog>
      </motion.header>

      {/* ── Period filter ── */}
      <motion.div variants={reducedMotion ? undefined : staggerChild}>
        <Tabs value={periodFilter} onValueChange={(v) => setPeriodFilter(v as PeriodFilter)}>
          <TabsList aria-label={t('forecasts.periodFilterLabel', 'Period filter')}>
            <TabsTrigger value="monthly">{t('forecasts.periodMonthly', 'Monthly')}</TabsTrigger>
            <TabsTrigger value="quarterly">{t('forecasts.periodQuarterly', 'Quarterly')}</TabsTrigger>
            <TabsTrigger value="yearly">{t('forecasts.periodYearly', 'Yearly')}</TabsTrigger>
          </TabsList>
        </Tabs>
      </motion.div>

      {/* ── Headline totals — the page's answer at a glance ── */}
      <motion.div
        variants={reducedMotion ? undefined : staggerChild}
        className="grid grid-cols-2 gap-3 sm:grid-cols-4"
        aria-label={t('forecasts.totalsLabel', 'Forecast totals for the selected period')}
      >
        {(
          [
            { key: 'commit', label: t('forecasts.totalCommit', 'Commit'), accent: true },
            { key: 'best_case', label: t('forecasts.totalBestCase', 'Best case'), accent: false },
            { key: 'pipeline', label: t('forecasts.totalPipeline', 'Pipeline'), accent: false },
            { key: 'closed', label: t('forecasts.totalClosed', 'Closed'), accent: false },
          ] as const
        ).map((k) => (
          <div
            key={k.key}
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] px-4 py-3"
          >
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
              {k.label}
            </div>
            <div
              className={`mt-1 text-lg font-bold tabular-nums ${
                k.accent ? 'text-[var(--success)]' : 'text-[var(--fg-primary)]'
              }`}
            >
              {formatMoneyMicros(totals[k.key], 'EUR')}
            </div>
          </div>
        ))}
      </motion.div>

      {/* ── Chart (desktop only; returns null when empty) ── */}
      <motion.div variants={reducedMotion ? undefined : staggerChild}>
        <ForecastChart
          chartData={chartData}
          maxTotal={maxTotal}
          formatMoneyMicros={formatMoneyMicros}
        />
      </motion.div>

      {/* ── List ── */}
      <motion.div variants={reducedMotion ? undefined : staggerChild}>
        <ForecastList
          rows={rows}
          isLoading={forecasts.isLoading}
          isError={forecasts.isError}
          errorMessage={forecasts.error?.message}
          onRetry={() => void forecasts.refetch()}
          onNewForecast={() => setDialogOpen(true)}
          onSaveCell={handleSaveCell}
          onDeleteRow={(row) => void handleDeleteRow(row)}
          formatMoneyMicros={formatMoneyMicros}
        />
      </motion.div>
    </motion.div>
  );
}

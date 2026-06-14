/**
 * ForecastsPage — lean orchestrator.
 * Owns: data fetching, mutations, derived state, page-level callbacks.
 * Delegates rendering to: ForecastChart, ForecastList, NewForecastDialogContent.
 */
import { useMemo, useState, useCallback } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

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
        toast.success('Forecast updated');
      } catch (err) {
        toast.error('Failed to update forecast', {
          description: err instanceof Error ? err.message : 'Unknown error',
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
          title: `Delete forecasts for ${row.period}?`,
          description: 'This will remove all category forecasts for this period and owner.',
          destructive: true,
        })
      ) {
        try {
          await Promise.all(ids.map((id) => deleteForecast.mutateAsync(id)));
          toast.success('Forecasts deleted');
        } catch (err) {
          toast.error('Failed to delete forecasts', {
            description: err instanceof Error ? err.message : 'Unknown error',
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
            Revenue Forecasts
          </h1>
          <p className="mt-1 text-sm text-[var(--fg-secondary)]">
            Will the bids we&apos;re piloting hit the number? Pipeline, best case, commit, and
            closed by period.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Icon name="plus" size={14} /> New Forecast
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
                toast.success('Forecast created');
                setDialogOpen(false);
              } catch (err) {
                toast.error('Failed to create forecast', {
                  description: err instanceof Error ? err.message : 'Unknown error',
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
          <TabsList aria-label="Period filter">
            <TabsTrigger value="monthly">Monthly</TabsTrigger>
            <TabsTrigger value="quarterly">Quarterly</TabsTrigger>
            <TabsTrigger value="yearly">Yearly</TabsTrigger>
          </TabsList>
        </Tabs>
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

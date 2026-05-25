import { useMemo, useState, useCallback } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

import { Card, SectionHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { EmptyState, LoadingSkeleton, ErrorState } from '@/components/ui/StateMessages';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableScrollArea,
} from '@/components/ui/Table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { Icon } from '@/components/ui/Icon';
import { toast } from '@/components/ui/Toast';
import { confirm } from '@/components/ui/ConfirmDialog';
import {
  useForecasts,
  useCreateForecast,
  useDeleteForecast,
} from '@/hooks/useForecasts';
import { useUsers } from '@/hooks/useUsers';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { staggerChild, staggerParent } from '@/lib/motion';
import type { Forecast } from '@bidstack/shared';

const CATEGORIES: Forecast['category'][] = ['pipeline', 'best_case', 'commit', 'closed'];

const CATEGORY_LABELS: Record<Forecast['category'], string> = {
  pipeline: 'Pipeline',
  best_case: 'Best Case',
  commit: 'Commit',
  closed: 'Closed',
};

const CATEGORY_COLOR: Record<Forecast['category'], string> = {
  pipeline: '#2c4bff',
  best_case: '#7c3aed',
  commit: '#d97706',
  closed: '#059669',
};

interface ForecastRow {
  ownerId: string;
  ownerName: string | null;
  period: string;
  pipeline: number;
  bestCase: number;
  commit: number;
  closed: number;
  ids: Record<Forecast['category'], string | undefined>;
}

type PeriodFilter = 'monthly' | 'quarterly' | 'yearly';

function groupForecasts(items: Forecast[]): ForecastRow[] {
  const map = new Map<string, ForecastRow>();
  for (const item of items) {
    const key = `${item.ownerId}|${item.period}`;
    let row = map.get(key);
    if (!row) {
      row = {
        ownerId: item.ownerId,
        ownerName: item.ownerName,
        period: item.period,
        pipeline: 0,
        bestCase: 0,
        commit: 0,
        closed: 0,
        ids: { pipeline: undefined, best_case: undefined, commit: undefined, closed: undefined },
      };
      map.set(key, row);
    }
    const fieldMap: Record<Forecast['category'], keyof Omit<ForecastRow, 'ownerId' | 'ownerName' | 'period' | 'ids'>> = {
      pipeline: 'pipeline',
      best_case: 'bestCase',
      commit: 'commit',
      closed: 'closed',
    };
    (row as unknown as Record<string, unknown>)[fieldMap[item.category]] = item.amountMicros;
    row.ids[item.category] = item.id;
  }
  return Array.from(map.values()).sort((a, b) => b.period.localeCompare(a.period));
}

function matchesPeriodFilter(period: string, filter: PeriodFilter): boolean {
  if (filter === 'monthly') return /^\d{4}-\d{2}$/.test(period);
  if (filter === 'quarterly') return /^\d{4}-Q\d$/.test(period);
  if (filter === 'yearly') return /^\d{4}$/.test(period);
  return true;
}

export function ForecastsPage() {
  const { formatMoneyMicros } = useFormatMoney();
  const reducedMotion = useReducedMotion();
  const forecasts = useForecasts();
  const users = useUsers();
  const createForecast = useCreateForecast();
  const deleteForecast = useDeleteForecast();

  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('monthly');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCell, setEditingCell] = useState<{
    ownerId: string;
    period: string;
    category: Forecast['category'];
    value: number;
  } | null>(null);

  const filteredItems = useMemo(() => {
    const items = forecasts.data?.items ?? [];
    return items.filter((i) => matchesPeriodFilter(i.period, periodFilter));
  }, [forecasts.data, periodFilter]);

  const rows = useMemo(() => groupForecasts(filteredItems), [filteredItems]);

  const chartData = useMemo(() => {
    const byPeriod = new Map<
      string,
      { pipeline: number; bestCase: number; commit: number; closed: number }
    >();
    for (const row of rows) {
      const existing = byPeriod.get(row.period);
      if (existing) {
        existing.pipeline += row.pipeline;
        existing.bestCase += row.bestCase;
        existing.commit += row.commit;
        existing.closed += row.closed;
      } else {
        byPeriod.set(row.period, {
          pipeline: row.pipeline,
          bestCase: row.bestCase,
          commit: row.commit,
          closed: row.closed,
        });
      }
    }
    return Array.from(byPeriod.entries())
      .map(([period, values]) => ({ period, ...values }))
      .sort((a, b) => a.period.localeCompare(b.period));
  }, [rows]);

  const maxTotal = useMemo(() => {
    if (chartData.length === 0) return 0;
    return Math.max(...chartData.map((d) => d.pipeline + d.bestCase + d.commit + d.closed));
  }, [chartData]);

  const handleCellSave = useCallback(
    async (ownerId: string, period: string, category: Forecast['category'], micros: number) => {
      try {
        await createForecast.mutateAsync({
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
      } finally {
        setEditingCell(null);
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

  const isLoading = forecasts.isLoading;
  const isError = forecasts.isError;

  return (
    <motion.div
      className="space-y-6"
      variants={reducedMotion ? undefined : staggerParent}
      initial={reducedMotion ? false : 'initial'}
      animate="animate"
    >
      {/* Header */}
      <motion.header
        variants={reducedMotion ? undefined : staggerChild}
        className="flex flex-wrap items-end justify-between gap-3"
      >
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">
            Revenue Forecasts
          </h1>
          <p className="mt-1 text-sm text-[var(--fg-secondary)]">
            Track pipeline, best case, commit, and closed revenue by period.
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

      {/* Period filter */}
      <motion.div variants={reducedMotion ? undefined : staggerChild}>
        <Tabs value={periodFilter} onValueChange={(v) => setPeriodFilter(v as PeriodFilter)}>
          <TabsList aria-label="Period filter">
            <TabsTrigger value="monthly">Monthly</TabsTrigger>
            <TabsTrigger value="quarterly">Quarterly</TabsTrigger>
            <TabsTrigger value="yearly">Yearly</TabsTrigger>
          </TabsList>
        </Tabs>
      </motion.div>

      {/* Chart */}
      {chartData.length > 0 && (
        <motion.div
          variants={reducedMotion ? undefined : staggerChild}
          className="hidden md:block"
        >
          <Card>
            <SectionHeader
              title="Forecast Breakdown"
              caption="Stacked by category across periods"
            />
            <div className="px-5 pb-5 pt-2">
              <div className="flex items-end gap-4" style={{ height: 220 }}>
                {chartData.map((d) => {
                  const total = d.pipeline + d.bestCase + d.commit + d.closed;
                  const heightPct = maxTotal > 0 ? (total / maxTotal) * 100 : 0;
                  return (
                    <div key={d.period} className="flex flex-1 flex-col items-center gap-2">
                      <div className="flex w-full flex-1 items-end justify-center">
                        <div
                          className="flex w-12 flex-col-reverse overflow-hidden rounded-md"
                          style={{ height: `${Math.max(heightPct, 0)}%` }}
                          role="img"
                          aria-label={`${d.period}: ${formatMoneyMicros(total, 'EUR')}`}
                        >
                          {CATEGORIES.map((cat) => {
                            const val = d[cat === 'best_case' ? 'bestCase' : cat];
                            const catPct = total > 0 ? (val / total) * 100 : 0;
                            return (
                              <div
                                key={cat}
                                style={{
                                  height: `${Math.max(catPct, 0)}%`,
                                  backgroundColor: CATEGORY_COLOR[cat],
                                  minHeight: val > 0 ? 2 : 0,
                                }}
                                title={`${CATEGORY_LABELS[cat]}: ${formatMoneyMicros(val, 'EUR')}`}
                              />
                            );
                          })}
                        </div>
                      </div>
                      <span className="text-[10px] font-medium text-[var(--fg-tertiary)]">
                        {d.period}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-4">
                {CATEGORIES.map((cat) => (
                  <div key={cat} className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-sm"
                      style={{ backgroundColor: CATEGORY_COLOR[cat] }}
                      aria-hidden
                    />
                    <span className="text-xs text-[var(--fg-secondary)]">
                      {CATEGORY_LABELS[cat]}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </motion.div>
      )}

      {/* Table */}
      <motion.div variants={reducedMotion ? undefined : staggerChild}>
        <Card>
          <SectionHeader
            title="Forecast Details"
            caption={`${rows.length} forecast groups`}
          />
          {isError ? (
            <ErrorState
              title="Failed to load forecasts"
              message={forecasts.error?.message}
              action={<Button onClick={() => forecasts.refetch()}>Retry</Button>}
            />
          ) : isLoading ? (
            <LoadingSkeleton rows={4} />
          ) : rows.length === 0 ? (
            <EmptyState
              title="No forecasts found"
              message={`Try changing the period filter or create your first forecast.`}
              action={
                <Button size="sm" onClick={() => setDialogOpen(true)}>
                  <Icon name="plus" size={14} /> New Forecast
                </Button>
              }
            />
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block">
                <TableScrollArea>
                  <Table aria-label="Revenue forecasts">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Owner</TableHead>
                        <TableHead>Period</TableHead>
                        <TableHead className="text-right">Pipeline</TableHead>
                        <TableHead className="text-right">Best Case</TableHead>
                        <TableHead className="text-right">Commit</TableHead>
                        <TableHead className="text-right">Closed</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="w-16" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row) => (
                        <TableRow key={`${row.ownerId}|${row.period}`}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-[var(--fg-primary)]">
                                {row.ownerName ?? 'Unassigned'}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge tone="gray">{row.period}</Badge>
                          </TableCell>
                          {CATEGORIES.map((cat) => {
                            const val =
                              cat === 'best_case'
                                ? row.bestCase
                                : cat === 'pipeline'
                                  ? row.pipeline
                                  : cat === 'commit'
                                    ? row.commit
                                    : row.closed;
                            const isEditing =
                              editingCell?.ownerId === row.ownerId &&
                              editingCell?.period === row.period &&
                              editingCell?.category === cat;
                            return (
                              <TableCell key={cat} className="text-right">
                                {isEditing ? (
                                  <Input
                                    type="number"
                                    size="sm"
                                    autoFocus
                                    defaultValue={val / 1_000_000}
                                    className="w-28 text-right"
                                    aria-label={`${CATEGORY_LABELS[cat]} amount for ${row.period}`}
                                    onBlur={(e) => {
                                      const num = Number(e.target.value);
                                      if (!Number.isNaN(num)) {
                                        void handleCellSave(
                                          row.ownerId,
                                          row.period,
                                          cat,
                                          Math.round(num * 1_000_000),
                                        );
                                      } else {
                                        setEditingCell(null);
                                      }
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        (e.target as HTMLInputElement).blur();
                                      }
                                      if (e.key === 'Escape') {
                                        setEditingCell(null);
                                      }
                                    }}
                                  />
                                ) : (
                                  <button
                                    type="button"
                                    className="inline-flex min-w-[80px] justify-end rounded px-3 py-2 text-sm tabular-nums text-[var(--fg-secondary)] transition-colors hover:bg-[var(--surface-sunken)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] pointer-coarse:min-h-[44px]"
                                    onClick={() =>
                                      setEditingCell({
                                        ownerId: row.ownerId,
                                        period: row.period,
                                        category: cat,
                                        value: val,
                                      })
                                    }
                                    aria-label={`Edit ${CATEGORY_LABELS[cat]} for ${row.period}`}
                                  >
                                    {formatMoneyMicros(val, 'EUR')}
                                  </button>
                                )}
                              </TableCell>
                            );
                          })}
                          <TableCell className="text-right">
                            <span className="text-sm font-semibold tabular-nums text-[var(--fg-primary)]">
                              {formatMoneyMicros(
                                row.pipeline + row.bestCase + row.commit + row.closed,
                                'EUR',
                              )}
                            </span>
                          </TableCell>
                          <TableCell>
                            <button
                              type="button"
                              onClick={() => void handleDeleteRow(row)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--fg-tertiary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--danger)] pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                              aria-label={`Delete forecasts for ${row.period}`}
                              title="Delete"
                            >
                              <Icon name="trash" size={14} />
                            </button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableScrollArea>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden space-y-3 p-4">
                {rows.map((row) => (
                  <div
                    key={`${row.ownerId}|${row.period}`}
                    className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium text-[var(--fg-primary)]">
                        {row.ownerName ?? 'Unassigned'}
                      </div>
                      <Badge tone="gray">{row.period}</Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {CATEGORIES.map((cat) => {
                        const val =
                          cat === 'best_case'
                            ? row.bestCase
                            : cat === 'pipeline'
                              ? row.pipeline
                              : cat === 'commit'
                                ? row.commit
                                : row.closed;
                        const isEditing =
                          editingCell?.ownerId === row.ownerId &&
                          editingCell?.period === row.period &&
                          editingCell?.category === cat;
                        return (
                          <div key={cat} className="flex flex-col gap-1">
                            <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--fg-tertiary)]">
                              {CATEGORY_LABELS[cat]}
                            </span>
                            {isEditing ? (
                              <Input
                                type="number"
                                size="sm"
                                autoFocus
                                defaultValue={val / 1_000_000}
                                aria-label={`${CATEGORY_LABELS[cat]} amount for ${row.period}`}
                                onBlur={(e) => {
                                  const num = Number(e.target.value);
                                  if (!Number.isNaN(num)) {
                                    void handleCellSave(
                                      row.ownerId,
                                      row.period,
                                      cat,
                                      Math.round(num * 1_000_000),
                                    );
                                  } else {
                                    setEditingCell(null);
                                  }
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    (e.target as HTMLInputElement).blur();
                                  }
                                  if (e.key === 'Escape') {
                                    setEditingCell(null);
                                  }
                                }}
                              />
                            ) : (
                              <button
                                type="button"
                                className="inline-flex justify-start rounded px-3 py-2 text-sm tabular-nums text-[var(--fg-secondary)] transition-colors hover:bg-[var(--surface-sunken)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] pointer-coarse:min-h-[44px]"
                                onClick={() =>
                                  setEditingCell({
                                    ownerId: row.ownerId,
                                    period: row.period,
                                    category: cat,
                                    value: val,
                                  })
                                }
                                aria-label={`Edit ${CATEGORY_LABELS[cat]} for ${row.period}`}
                              >
                                {formatMoneyMicros(val, 'EUR')}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-3">
                      <span className="text-xs font-semibold text-[var(--fg-primary)]">
                        Total:{' '}
                        {formatMoneyMicros(
                          row.pipeline + row.bestCase + row.commit + row.closed,
                          'EUR',
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleDeleteRow(row)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--fg-tertiary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--danger)] pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                        aria-label={`Delete forecasts for ${row.period}`}
                        title="Delete"
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </motion.div>
    </motion.div>
  );
}

function NewForecastDialogContent({
  users,
  onClose,
  onSubmit,
  isPending,
}: {
  users: Array<{ id: string; name: string | null; email: string }>;
  onClose: () => void;
  onSubmit: (body: {
    period: string;
    ownerId: string;
    amounts: Record<Forecast['category'], number>;
  }) => void;
  isPending: boolean;
}) {
  const [period, setPeriod] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [amounts, setAmounts] = useState<Record<Forecast['category'], string>>({
    pipeline: '',
    best_case: '',
    commit: '',
    closed: '',
  });

  const canSubmit =
    period.trim().length > 0 &&
    !isPending &&
    Object.values(amounts).some((v) => v.trim().length > 0 && Number(v) > 0);

  return (
    <DialogContent title="New Forecast" description="Enter amounts for each category.">
      <div className="space-y-4">
        <Input
          label="Period"
          placeholder="e.g. 2026-05, 2026-Q2, or 2026"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          required
        />
        <Select
          label="Owner"
          value={ownerId}
          onChange={(e) => setOwnerId(e.target.value)}
          options={[
            { value: '', label: 'Select owner…' },
            ...users.map((u) => ({ value: u.id, label: u.name ?? u.email })),
          ]}
        />
        <div className="grid grid-cols-2 gap-3">
          {CATEGORIES.map((cat) => (
            <Input
              key={cat}
              label={CATEGORY_LABELS[cat]}
              type="number"
              min={0}
              placeholder="0"
              value={amounts[cat]}
              onChange={(e) =>
                setAmounts((prev) => ({ ...prev, [cat]: e.target.value }))
              }
            />
          ))}
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() =>
              onSubmit({
                period: period.trim(),
                ownerId,
                amounts: {
                  pipeline: Math.round(Number(amounts.pipeline || 0) * 1_000_000),
                  best_case: Math.round(Number(amounts.best_case || 0) * 1_000_000),
                  commit: Math.round(Number(amounts.commit || 0) * 1_000_000),
                  closed: Math.round(Number(amounts.closed || 0) * 1_000_000),
                },
              })
            }
          >
            {isPending ? 'Saving…' : 'Save Forecast'}
          </Button>
        </div>
      </div>
    </DialogContent>
  );
}

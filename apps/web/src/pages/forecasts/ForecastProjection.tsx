/**
 * ForecastProjection — the primary, always-populated forecast view: a
 * pipeline-weighted projection derived from open opportunities (value × stage
 * win-probability), bucketed by close-date quarter and owner. Self-contained
 * (owns its query + period selection); manual /forecasts rows render below it.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card, SectionHeader } from '@/components/ui/Card';
import { EmptyState, LoadingSkeleton, ErrorState } from '@/components/ui/StateMessages';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableScrollArea,
} from '@/components/ui/Table';
import { useForecastProjection } from '@/hooks/useForecasts';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import type { ForecastProjectionPeriod } from '@bidstack/shared';

type FormatMoney = (micros: number, currency?: string) => string;

export function ForecastProjection() {
  const { t } = useTranslation('crm');
  const { formatMoneyMicros } = useFormatMoney();
  const projection = useForecastProjection();
  const [selected, setSelected] = useState<string | null>(null);

  const periods = projection.data?.periods ?? [];
  const activePeriod = periods.find((p) => p.period === selected) ?? periods[0];
  const hasPipeline = periods.some((p) => p.openMicros > 0 || p.wonMicros > 0);

  return (
    <Card>
      <SectionHeader
        title={t('forecastProjection.title', 'Weighted pipeline projection')}
        caption={t(
          'forecastProjection.caption',
          'Open opportunities × stage win-probability, by close-date quarter.',
        )}
      />

      {projection.isError ? (
        <ErrorState
          title={t('forecastProjection.errorTitle', 'Failed to load projection')}
          message={projection.error instanceof Error ? projection.error.message : undefined}
          action={
            <Button onClick={() => void projection.refetch()}>
              {t('forecastProjection.retry', 'Retry')}
            </Button>
          }
        />
      ) : projection.isLoading ? (
        <LoadingSkeleton rows={4} />
      ) : !hasPipeline || !activePeriod ? (
        <EmptyState
          title={t('forecastProjection.emptyTitle', 'No open pipeline to forecast')}
          message={t(
            'forecastProjection.emptyMessage',
            'Once opportunities are in flight, their weighted value appears here automatically.',
          )}
        />
      ) : (
        <div className="space-y-5 p-5">
          <Tabs value={activePeriod.period} onValueChange={setSelected}>
            <TabsList aria-label={t('forecastProjection.periodLabel', 'Forecast period')}>
              {periods.map((p) => (
                <TabsTrigger key={p.period} value={p.period}>
                  {p.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <ProjectionTotals period={activePeriod} formatMoneyMicros={formatMoneyMicros} t={t} />
          <ProjectionOwnerTable period={activePeriod} formatMoneyMicros={formatMoneyMicros} t={t} />
        </div>
      )}
    </Card>
  );
}

interface SubProps {
  period: ForecastProjectionPeriod;
  formatMoneyMicros: FormatMoney;
  t: (key: string, defaultValue: string) => string;
}

function ProjectionTotals({ period, formatMoneyMicros, t }: SubProps) {
  const cards = [
    {
      key: 'weighted',
      label: t('forecastProjection.weighted', 'Weighted'),
      value: period.weightedMicros,
      accent: true,
    },
    { key: 'open', label: t('forecastProjection.open', 'Open pipeline'), value: period.openMicros },
    { key: 'won', label: t('forecastProjection.won', 'Closed won'), value: period.wonMicros },
  ];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {cards.map((c) => (
        <div
          key={c.key}
          className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] px-4 py-3"
        >
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
              {c.label}
            </div>
            {c.key === 'weighted' && period.manualCommitMicros !== null ? (
              <Badge tone="amber">
                {t('forecastProjection.override', 'Manual commit')}:{' '}
                {formatMoneyMicros(period.manualCommitMicros, 'EUR')}
              </Badge>
            ) : null}
          </div>
          <div
            className={`mt-1 text-lg font-bold tabular-nums ${
              c.accent ? 'text-[var(--brand-primary)]' : 'text-[var(--fg-primary)]'
            }`}
          >
            {formatMoneyMicros(c.value, 'EUR')}
          </div>
        </div>
      ))}
    </div>
  );
}

function ProjectionOwnerTable({ period, formatMoneyMicros, t }: SubProps) {
  if (period.byOwner.length === 0) {
    return (
      <p className="px-1 py-4 text-sm text-[var(--fg-tertiary)]">
        {t('forecastProjection.noOwners', 'No open opportunities owned in this period.')}
      </p>
    );
  }
  return (
    <TableScrollArea>
      <Table aria-label={t('forecastProjection.ownerTableLabel', 'Weighted pipeline by owner')}>
        <TableHeader>
          <TableRow>
            <TableHead>{t('forecastProjection.colOwner', 'Owner')}</TableHead>
            <TableHead className="text-right">
              {t('forecastProjection.colOpen', 'Open')}
            </TableHead>
            <TableHead className="text-right">
              {t('forecastProjection.colWeighted', 'Weighted')}
            </TableHead>
            <TableHead className="text-right">{t('forecastProjection.colWon', 'Won')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {period.byOwner.map((o) => (
            <TableRow key={o.ownerId ?? 'unassigned'}>
              <TableCell>
                <span className="text-sm font-medium text-[var(--fg-primary)]">{o.ownerName}</span>
              </TableCell>
              <TableCell className="text-right tabular-nums text-[var(--fg-secondary)]">
                {formatMoneyMicros(o.openMicros, 'EUR')}
              </TableCell>
              <TableCell className="text-right tabular-nums font-semibold text-[var(--fg-primary)]">
                {formatMoneyMicros(o.weightedMicros, 'EUR')}
              </TableCell>
              <TableCell className="text-right tabular-nums text-[var(--fg-secondary)]">
                {formatMoneyMicros(o.wonMicros, 'EUR')}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableScrollArea>
  );
}

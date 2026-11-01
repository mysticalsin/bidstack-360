/**
 * ForecastChart — stacked bar chart showing pipeline / best-case / commit /
 * closed revenue per period. Pure display; no data fetching.
 */
import { useTranslation } from 'react-i18next';

import { Card, SectionHeader } from '@/components/ui/Card';

import { compareMicros, microsSharePercent } from '@/components/dashboard/unspecified-currency';

import {
  CATEGORIES,
  CATEGORY_COLOR,
  CATEGORY_LABELS,
  formatForecastAmount,
  sumForecastMicros,
  type ChartDatum,
} from './forecastsConfig';

interface ForecastChartProps {
  chartData: ChartDatum[];
}

function seriesMax(series: ChartDatum[]): string {
  return series.reduce((max, datum) => {
    const total = sumForecastMicros(datum.pipeline, datum.bestCase, datum.commit, datum.closed).toString();
    return compareMicros(total, max) > 0 ? total : max;
  }, '0');
}

export function ForecastChart({ chartData }: ForecastChartProps) {
  const { t } = useTranslation('crm');

  if (chartData.length === 0) return null;

  const currencies = [...new Set(chartData.map((datum) => datum.currency))].sort((a, b) => {
    if (a === 'XXX') return -1;
    if (b === 'XXX') return 1;
    return a.localeCompare(b);
  });

  return (
    <div className="hidden md:block">
      <Card>
        <SectionHeader
          title={t('forecastChart.title', 'Forecast Breakdown')}
          caption={t('forecastChart.caption', 'Stacked by category across periods')}
        />
        <div className="space-y-6 px-5 pb-5 pt-2">
          {currencies.map((code) => {
            const series = chartData.filter((datum) => datum.currency === code);
            const maxTotal = seriesMax(series);
            const showHeading = code !== 'XXX' || currencies.length > 1;
            const heading =
              code === 'XXX' ? t('forecastChart.unspecified', 'Unspecified') : code;
            return (
              <div key={code} aria-label={heading}>
                {showHeading ? (
                  <p className="mb-2 text-xs font-medium text-[var(--fg-secondary)]">{heading}</p>
                ) : null}
                <div className="flex items-end gap-4" style={{ height: 220 }}>
                  {series.map((datum) => {
                    const total = sumForecastMicros(
                      datum.pipeline,
                      datum.bestCase,
                      datum.commit,
                      datum.closed,
                    ).toString();
                    const heightPct = microsSharePercent(total, maxTotal);
                    return (
                      <div key={datum.period} className="flex flex-1 flex-col items-center gap-2">
                        <div className="flex w-full flex-1 items-end justify-center">
                          <div
                            className="flex w-12 flex-col-reverse overflow-hidden rounded-md"
                            style={{ height: `${Math.max(heightPct, 0)}%` }}
                            role="img"
                            aria-label={`${datum.period}: ${formatForecastAmount(total, code)}`}
                          >
                            {CATEGORIES.map((cat) => {
                              const val = datum[cat === 'best_case' ? 'bestCase' : cat];
                              const catPct = microsSharePercent(val, total);
                              return (
                                <div
                                  key={cat}
                                  style={{
                                    height: `${Math.max(catPct, 0)}%`,
                                    backgroundColor: CATEGORY_COLOR[cat],
                                    minHeight: compareMicros(val, 0) > 0 ? 2 : 0,
                                  }}
                                  title={`${CATEGORY_LABELS[cat]}: ${formatForecastAmount(val, code)}`}
                                />
                              );
                            })}
                          </div>
                        </div>
                        <span className="text-[10px] font-medium text-[var(--fg-tertiary)]">
                          {datum.period}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center justify-center gap-4">
            {CATEGORIES.map((cat) => (
              <div key={cat} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: CATEGORY_COLOR[cat] }}
                  aria-hidden
                />
                <span className="text-xs text-[var(--fg-secondary)]">{CATEGORY_LABELS[cat]}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}

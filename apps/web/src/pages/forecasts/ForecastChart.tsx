/**
 * ForecastChart — stacked bar chart showing pipeline / best-case / commit /
 * closed revenue per period. Pure display; no data fetching.
 */
import { Card, SectionHeader } from '@/components/ui/Card';

import { CATEGORIES, CATEGORY_COLOR, CATEGORY_LABELS, type ChartDatum } from './forecastsConfig';

interface ForecastChartProps {
  chartData: ChartDatum[];
  maxTotal: number;
  formatMoneyMicros: (micros: number, currency: string) => string;
}

export function ForecastChart({ chartData, maxTotal, formatMoneyMicros }: ForecastChartProps) {
  if (chartData.length === 0) return null;

  return (
    <div className="hidden md:block">
      <Card>
        <SectionHeader title="Forecast Breakdown" caption="Stacked by category across periods" />
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
                <span className="text-xs text-[var(--fg-secondary)]">{CATEGORY_LABELS[cat]}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}

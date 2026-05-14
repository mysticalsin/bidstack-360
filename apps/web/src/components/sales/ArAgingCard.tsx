// Accounts Receivable aging buckets — visual bar chart of outstanding
// invoices grouped by days past due. Mirrors the Odoo "Aged Receivable"
// report in a compact dashboard card.

import { motion, useReducedMotion } from 'framer-motion';

import { Card, SectionHeader } from '@/components/ui/Card';
import { LoadingSkeleton } from '@/components/ui/StateMessages';
import { formatMoneyMicros } from '@/lib/format';
import { springSoft } from '@/lib/motion';

import type { ArAgingReport } from '@bidstack/shared';

interface Props {
  data: ArAgingReport | undefined;
  isLoading: boolean;
}

const BAR_TONES = [
  'bg-[var(--brand-primary)]',
  'bg-[var(--fg-amber)]',
  'bg-[var(--fg-tomato)]',
  'bg-[var(--fg-error)]',
];

export function ArAgingCard({ data, isLoading }: Props) {
  const reducedMotion = useReducedMotion();
  const total = data ? BigInt(data.totalOutstandingMicros) : 0n;

  return (
    <Card>
      <SectionHeader title="A/R Aging" caption={data ? `Currency: ${data.currency}` : undefined} />
      {isLoading ? (
        <div className="p-5">
          <LoadingSkeleton rows={4} />
        </div>
      ) : !data || data.buckets.every((b) => b.invoiceCount === 0) ? (
        <div className="p-5 text-sm text-[var(--fg-secondary)]">
          No outstanding invoices — all caught up.
        </div>
      ) : (
        <div className="space-y-4 p-5">
          {/* Total headline */}
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-medium text-[var(--fg-secondary)]">
              Total Outstanding
            </span>
            <span className="text-lg font-semibold text-[var(--fg-primary)]">
              {formatMoneyMicros(data.totalOutstandingMicros, data.currency)}
            </span>
          </div>

          {/* Stacked bar */}
          <div className="flex h-3 overflow-hidden rounded-full">
            {data.buckets.map((b, i) => {
              const value = BigInt(b.outstandingMicros);
              const pct = total > 0n ? Number((value * 100n) / total) : 0;
              if (pct === 0) return null;
              return (
                <motion.div
                  key={b.label}
                  className={`${BAR_TONES[i]} first:rounded-l-full last:rounded-r-full`}
                  initial={reducedMotion ? { width: 0 } : { width: 0, opacity: 0 }}
                  animate={{ width: `${pct}%`, opacity: 1 }}
                  transition={{ ...springSoft, delay: reducedMotion ? 0 : i * 0.06 }}
                  title={`${b.label}: ${formatMoneyMicros(b.outstandingMicros, data.currency)} (${pct}%)`}
                />
              );
            })}
          </div>

          {/* Legend rows */}
          <div className="space-y-2">
            {data.buckets.map((b, i) => {
              const value = BigInt(b.outstandingMicros);
              const pct = total > 0n ? Number((value * 100n) / total) : 0;
              return (
                <div key={b.label} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${BAR_TONES[i]}`} />
                    <span className="text-[var(--fg-secondary)]">{b.label}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-[var(--fg-muted)]">{b.invoiceCount} inv.</span>
                    <span className="font-medium text-[var(--fg-primary)]">
                      {formatMoneyMicros(b.outstandingMicros, data.currency)}
                    </span>
                    <span className="w-10 text-right text-xs text-[var(--fg-muted)]">{pct}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

// Reusable top-N revenue table for Sales Dashboard widgets:
//   Top Quotations / Top Sales Orders / Top Customers
//
// Columns: Customer (or label), Salesperson (optional), Revenue.
// Highlights the leading row with a tinted bar so a glance reads the leader.
// Rows are clickable when the row's `id` looks like a UUID — that lets
// quotations/orders (real SalesOrder rows) drill into the detail page,
// while customer-grouped rows (synthetic ids like "Name-N") stay inert.

import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';

import { useFormatMoney } from '@/hooks/useFormatMoney';
import { springSoft } from '@/lib/motion';

import type { TopRow } from '@bidstack/shared';

interface Props {
  items: TopRow[];
  showSalesperson?: boolean;
  /** Whether the bar tone is the cool one (quotations) or warm (orders). */
  variant?: 'quotation' | 'order' | 'customer';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function TopList({ items, showSalesperson = true, variant = 'quotation' }: Props) {
  const reducedMotion = useReducedMotion();
  const { formatMoneyMicros } = useFormatMoney();

  if (items.length === 0) {
    return (
      <motion.div
        initial={reducedMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springSoft}
        className="rounded-md bg-[var(--surface-subtle)] px-4 py-6 text-sm text-[var(--fg-tertiary)]"
      >
        No records yet.
      </motion.div>
    );
  }
  const max = items.reduce((acc, it) => {
    const v = Number(BigInt(it.revenueMicros) / BigInt(1_000_000));
    return v > acc ? v : acc;
  }, 1);
  const barClass = variant === 'order' ? 'bg-[var(--warning-tint)]' : 'bg-[var(--info-tint)]';

  return (
    <div className="overflow-hidden rounded-md">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-[var(--fg-tertiary)]">
            <th scope="col" className="px-4 py-2 font-medium">
              Customer
            </th>
            {showSalesperson ? (
              <th scope="col" className="px-4 py-2 font-medium">
                Salesperson
              </th>
            ) : null}
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Revenue ▼
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((row, index) => {
            const v = Number(BigInt(row.revenueMicros) / BigInt(1_000_000));
            const pct = max > 0 ? Math.min(100, (v / max) * 100) : 0;
            return (
              <motion.tr
                key={row.id}
                initial={reducedMotion ? false : { opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                whileHover={reducedMotion ? undefined : { x: 2 }}
                transition={{ ...springSoft, delay: reducedMotion ? 0 : index * 0.025 }}
                className="relative border-t border-[var(--border-subtle)]"
              >
                <td className="relative px-4 py-2.5 align-middle">
                  {/* Bar background scales with the row's share of the max. */}
                  <motion.span
                    aria-hidden
                    className={`absolute inset-y-1 left-1 rounded ${barClass}`}
                    initial={reducedMotion ? false : { width: 0 }}
                    animate={{ width: `calc(${pct.toFixed(2)}% - 8px)` }}
                    transition={{ ...springSoft, delay: reducedMotion ? 0 : index * 0.025 }}
                  />
                  {UUID_RE.test(row.id) ? (
                    <Link
                      to={`/sales/orders/${row.id}`}
                      className="relative truncate font-medium text-[var(--brand-primary)] underline-offset-2 hover:underline"
                    >
                      {row.label}
                    </Link>
                  ) : (
                    <span className="relative truncate font-medium text-[var(--fg-primary)]">
                      {row.label}
                    </span>
                  )}
                </td>
                {showSalesperson ? (
                  <td className="px-4 py-2.5 text-[var(--fg-secondary)] whitespace-nowrap">
                    {row.salesperson ?? '—'}
                  </td>
                ) : null}
                <td className="px-4 py-2.5 text-right tabular-nums text-[var(--fg-primary)] whitespace-nowrap">
                  {formatMoneyMicros(row.revenueMicros, row.currency ?? 'EUR')}
                </td>
              </motion.tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

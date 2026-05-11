// Reusable top-N revenue table for Sales Dashboard widgets:
//   Top Quotations / Top Sales Orders / Top Customers
//
// Columns: Customer (or label), Salesperson (optional), Revenue.
// Highlights the leading row with a tinted bar so a glance reads the leader.
// Rows are clickable when the row's `id` looks like a UUID — that lets
// quotations/orders (real SalesOrder rows) drill into the detail page,
// while customer-grouped rows (synthetic ids like "Name-N") stay inert.

import { Link } from 'react-router-dom';

import { formatMoneyMicros } from '@/lib/format';

import type { TopRow } from '@bidstack/shared';

interface Props {
  items: TopRow[];
  showSalesperson?: boolean;
  /** Whether the bar tone is the cool one (quotations) or warm (orders). */
  variant?: 'quotation' | 'order' | 'customer';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function TopList({ items, showSalesperson = true, variant = 'quotation' }: Props) {
  if (items.length === 0) {
    return (
      <div className="rounded-md bg-[var(--surface-subtle)] px-4 py-6 text-sm text-[var(--fg-tertiary)]">
        No records yet.
      </div>
    );
  }
  const max = items.reduce((acc, it) => {
    const v = Number(BigInt(it.revenueMicros) / BigInt(1_000_000));
    return v > acc ? v : acc;
  }, 1);
  const barClass =
    variant === 'order' ? 'bg-[#fff7ea]' : variant === 'customer' ? 'bg-[#eef4ff]' : 'bg-[#eef4ff]';

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
          {items.map((row) => {
            const v = Number(BigInt(row.revenueMicros) / BigInt(1_000_000));
            const pct = max > 0 ? Math.min(100, (v / max) * 100) : 0;
            return (
              <tr key={row.id} className="relative border-t border-[var(--border-subtle)]">
                <td className="relative px-4 py-2.5 align-middle">
                  {/* Bar background scales with the row's share of the max. */}
                  <span
                    aria-hidden
                    className={`absolute inset-y-1 left-1 -z-0 rounded ${barClass}`}
                    style={{ width: `calc(${pct.toFixed(2)}% - 8px)` }}
                  />
                  {UUID_RE.test(row.id) ? (
                    <Link
                      to={`/sales/orders/${row.id}`}
                      className="relative z-10 truncate font-medium text-[var(--brand-primary)] underline-offset-2 hover:underline"
                    >
                      {row.label}
                    </Link>
                  ) : (
                    <span className="relative z-10 truncate font-medium text-[var(--fg-primary)]">
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
                  {formatMoneyMicros(row.revenueMicros, row.currency)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

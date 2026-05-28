// /sales/orders — list view with filter chips, search, and pagination.
// Reads ?state, ?country, ?salespersonId, ?search from the URL so the
// dashboard's Top-N rows can deep-link straight into a pre-filtered list.

import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { OrderStateBadge } from '@/components/sales/OrderStateBadge';
import { Card, SectionHeader } from '@/components/ui/Card';
import { LiquidGlassButton } from '@/components/ui/LiquidGlassButton';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { SpotlightTable, SpotlightTableRow } from '@/components/ui/SpotlightTable';
import { downloadCsv, rowsToCsv } from '@/lib/csv';
import { formatDate, formatMoneyMicros } from '@/lib/format';
import { useSalesOrders, type SalesOrdersListFilter } from '@/hooks/useSalesOrders';

import type { OrderState } from '@bidstack/shared';

const STATES: Array<{ id: OrderState | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'draft', label: 'Quotations · draft' },
  { id: 'sent', label: 'Quotations · sent' },
  { id: 'confirmed', label: 'Orders · confirmed' },
  { id: 'done', label: 'Orders · done' },
  { id: 'cancelled', label: 'Cancelled' },
];

export function SalesOrdersPage() {
  const [params, setParams] = useSearchParams();

  const filter = useMemo<SalesOrdersListFilter>(() => {
    const state = params.get('state') as OrderState | null;
    const country = params.get('country') ?? undefined;
    const salespersonId = params.get('salespersonId') ?? undefined;
    const search = params.get('search') ?? undefined;
    return {
      state: state ?? undefined,
      countryCode: country,
      salespersonId,
      search,
      limit: 50,
    };
  }, [params]);

  const list = useSalesOrders(filter);

  const setQueryParam = (key: string, value: string | null): void => {
    const next = new URLSearchParams(params);
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const onExport = (): void => {
    const items = list.data?.items ?? [];
    if (items.length === 0) return;
    // Convert wire-format (string micros, ISO dates) into spreadsheet-
    // friendly columns. Amount stays raw-decimal so Excel can SUM() it;
    // formatted display column comes alongside for human reading.
    const csv = rowsToCsv(
      items.map((row) => ({
        number: row.number,
        state: row.state,
        customer: row.customerName,
        salesperson: row.salespersonName ?? '',
        country: row.countryCode ?? '',
        date: row.orderDate.slice(0, 10),
        confirmedAt: row.confirmedAt?.slice(0, 10) ?? '',
        currency: row.currency,
        total: Number(row.totalMicros) / 1_000_000,
        totalFormatted: formatMoneyMicros(row.totalMicros, row.currency),
        lineCount: row.lineCount,
      })),
      [
        { key: 'number', label: 'Number' },
        { key: 'state', label: 'State' },
        { key: 'customer', label: 'Customer' },
        { key: 'salesperson', label: 'Salesperson' },
        { key: 'country', label: 'Country' },
        { key: 'date', label: 'Date' },
        { key: 'confirmedAt', label: 'Confirmed' },
        { key: 'currency', label: 'Currency' },
        { key: 'total', label: 'Total' },
        { key: 'totalFormatted', label: 'Total (formatted)' },
        { key: 'lineCount', label: 'Lines' },
      ],
    );
    const stamp = new Date().toISOString().slice(0, 10);
    const tag = filter.state ? `-${filter.state}` : '';
    downloadCsv(`sales-orders${tag}-${stamp}.csv`, csv);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--fg-primary)]">
            Quotations & Orders
          </h1>
          <p className="mt-1 text-sm text-[var(--fg-secondary)]">
            Sales pipeline from draft quotation through confirmed order.
          </p>
        </div>
        <LiquidGlassButton
          type="button"
          onClick={onExport}
          disabled={!list.data || list.data.items.length === 0}
          tone="secondary"
          size="sm"
        >
          Export CSV
        </LiquidGlassButton>
      </header>

      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        {STATES.map((s) => {
          const active = filter.state === s.id || (s.id === 'all' && !filter.state);
          return (
            <button
              key={s.id}
              type="button"
              aria-pressed={active}
              onClick={() => setQueryParam('state', s.id === 'all' ? null : s.id)}
              className={
                active
                  ? 'inline-flex min-h-9 items-center rounded-full border border-[var(--brand-primary)] bg-[var(--brand-primary)] px-3 py-1.5 text-xs font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 pointer-coarse:min-h-11'
                  : 'inline-flex min-h-9 items-center rounded-full border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 py-1.5 text-xs text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 pointer-coarse:min-h-11'
              }
            >
              {s.label}
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-2">
          <input
            type="search"
            value={filter.search ?? ''}
            onChange={(e) => setQueryParam('search', e.target.value)}
            placeholder="Search number or customer…"
            aria-label="Search"
            className="min-h-9 w-64 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 text-sm outline-none focus:ring-2 focus:ring-[var(--border-focus)]"
          />
          {filter.countryCode ? (
            <button
              type="button"
              onClick={() => setQueryParam('country', null)}
              aria-label={`Clear country filter ${filter.countryCode}`}
              className="inline-flex min-h-9 items-center rounded-full border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-3 py-1.5 text-xs text-[var(--fg-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 pointer-coarse:min-h-11"
            >
              Country: {filter.countryCode} ✕
            </button>
          ) : null}
          {filter.salespersonId ? (
            <button
              type="button"
              onClick={() => setQueryParam('salespersonId', null)}
              aria-label="Clear salesperson filter"
              className="inline-flex min-h-9 items-center rounded-full border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-3 py-1.5 text-xs text-[var(--fg-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 pointer-coarse:min-h-11"
            >
              Salesperson ✕
            </button>
          ) : null}
        </div>
      </div>

      {/* sr-only live region — announces filter/search result count to AT */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {list.data
          ? `${list.data.items.length} result${list.data.items.length === 1 ? '' : 's'}${list.data.nextCursor ? ' or more' : ''}`
          : ''}
      </p>

      {/* Result table */}
      <Card>
        <SectionHeader
          title={
            list.data ? `${list.data.items.length} results${list.data.nextCursor ? '+' : ''}` : '—'
          }
        />
        {list.isLoading ? (
          <div className="p-5">
            <LoadingSkeleton rows={6} />
          </div>
        ) : list.isError ? (
          <div className="p-5">
            <ErrorState
              title="Couldn't load orders"
              message={
                list.error instanceof Error ? list.error.message : 'The server did not respond.'
              }
              action={
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void list.refetch()}
                >
                  Retry
                </button>
              }
            />
          </div>
        ) : list.data && list.data.items.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-[var(--fg-tertiary)]">
            No matching quotations or orders.
          </div>
        ) : (
          <SpotlightTable query={filter.search} minWidth={820}>
            <thead>
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  Number
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Customer
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  State
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Salesperson
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Country
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Date
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Total ▼
                </th>
              </tr>
            </thead>
            <tbody>
              {list.data?.items.map((row) => (
                <SpotlightTableRow
                  key={row.id}
                  query={filter.search}
                  searchableText={`${row.number} ${row.customerName} ${row.state} ${row.salespersonName ?? ''} ${row.countryCode ?? ''}`}
                >
                  <td className="px-4 py-2.5">
                    <Link
                      to={`/sales/orders/${row.id}`}
                      className="font-mono text-xs text-[var(--brand-primary)] underline-offset-2 hover:underline"
                    >
                      {row.number}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-[var(--fg-primary)]">{row.customerName}</td>
                  <td className="px-4 py-2.5">
                    <OrderStateBadge state={row.state} />
                  </td>
                  <td className="px-4 py-2.5 text-[var(--fg-secondary)]">
                    {row.salespersonName ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-[var(--fg-secondary)]">
                    {row.countryCode ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-[var(--fg-tertiary)] whitespace-nowrap">
                    {formatDate(row.orderDate)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-[var(--fg-primary)] whitespace-nowrap">
                    {formatMoneyMicros(row.totalMicros, row.currency)}
                  </td>
                </SpotlightTableRow>
              ))}
            </tbody>
          </SpotlightTable>
        )}
        {list.data?.nextCursor ? (
          <div className="border-t border-[var(--border-subtle)] px-5 py-3 text-right">
            <button
              type="button"
              onClick={() => setQueryParam('cursor', list.data.nextCursor)}
              className="inline-flex min-h-9 items-center rounded-md px-3 py-1.5 text-xs font-medium text-[var(--brand-primary)] underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 pointer-coarse:min-h-11"
            >
              Load older →
            </button>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

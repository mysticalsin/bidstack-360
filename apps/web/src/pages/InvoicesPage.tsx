// /sales/invoices — list view with filter chips, search, and cursor pagination.

import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { InvoiceStateBadge } from '@/components/sales/InvoiceStateBadge';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { downloadCsv, rowsToCsv } from '@/lib/csv';
import { formatDate, formatMoneyMicros } from '@/lib/format';
import { useInvoices, type InvoicesListFilter } from '@/hooks/useInvoices';

import type { InvoiceState } from '@bidstack/shared';

const STATES: Array<{ id: InvoiceState | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'draft', label: 'Draft' },
  { id: 'sent', label: 'Sent' },
  { id: 'paid', label: 'Paid' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'cancelled', label: 'Cancelled' },
];

export function InvoicesPage() {
  const [params, setParams] = useSearchParams();

  const filter = useMemo<InvoicesListFilter>(() => {
    const state = params.get('state') as InvoiceState | null;
    const search = params.get('search') ?? undefined;
    const overdueOnly = params.get('overdueOnly') === 'true';
    return {
      state: state ?? undefined,
      search,
      overdueOnly,
      limit: 50,
    };
  }, [params]);

  const list = useInvoices(filter);
  const { refetch } = list;
  const [cursorStack, setCursorStack] = useState<string[]>([]);

  const setQueryParam = (key: string, value: string | null): void => {
    const next = new URLSearchParams(params);
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
    setCursorStack([]);
  };

  const onNextPage = (): void => {
    const nextCursor = list.data?.nextCursor;
    if (!nextCursor) return;
    setCursorStack((prev) => [...prev, nextCursor]);
    const next = new URLSearchParams(params);
    next.set('cursor', nextCursor);
    setParams(next, { replace: true });
  };

  const onPrevPage = (): void => {
    setCursorStack((prev) => {
      const next = [...prev];
      next.pop();
      return next;
    });
    const next = new URLSearchParams(params);
    next.delete('cursor');
    if (cursorStack.length > 1) {
      const prevCursor = cursorStack[cursorStack.length - 2];
      if (prevCursor) next.set('cursor', prevCursor);
    }
    setParams(next, { replace: true });
  };

  const onExport = (): void => {
    const items = list.data?.items ?? [];
    if (items.length === 0) return;
    const csv = rowsToCsv(
      items.map((row) => ({
        number: row.number,
        state: row.state,
        customer: row.customerName,
        currency: row.currency,
        total: Number(row.totalMicros) / 1_000_000,
        totalFormatted: formatMoneyMicros(row.totalMicros, row.currency),
        paid: Number(row.paidMicros) / 1_000_000,
        balance: Number(row.balanceMicros) / 1_000_000,
        invoiceDate: row.invoiceDate.slice(0, 10),
        dueDate: row.dueDate.slice(0, 10),
        lineCount: row.lineCount,
      })),
      [
        { key: 'number', label: 'Number' },
        { key: 'state', label: 'State' },
        { key: 'customer', label: 'Customer' },
        { key: 'currency', label: 'Currency' },
        { key: 'total', label: 'Total' },
        { key: 'totalFormatted', label: 'Total (formatted)' },
        { key: 'paid', label: 'Paid' },
        { key: 'balance', label: 'Balance' },
        { key: 'invoiceDate', label: 'Invoice Date' },
        { key: 'dueDate', label: 'Due Date' },
        { key: 'lineCount', label: 'Lines' },
      ],
    );
    const stamp = new Date().toISOString().slice(0, 10);
    const tag = filter.state ? `-${filter.state}` : '';
    downloadCsv(`invoices${tag}-${stamp}.csv`, csv);
  };

  const items = list.data?.items ?? [];
  const hasNext = Boolean(list.data?.nextCursor);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--fg-primary)]">Invoices</h1>
          <p className="mt-1 text-sm text-[var(--fg-secondary)]">
            Customer invoices from draft through paid.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/sales/invoices/new"
            className="inline-flex min-h-9 items-center rounded-md bg-[var(--brand-primary)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--brand-primary-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 pointer-coarse:min-h-11"
          >
            + New invoice
          </Link>
          <button
            type="button"
            onClick={onExport}
            disabled={!list.data || items.length === 0}
            className="inline-flex min-h-9 items-center rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 py-1.5 text-xs font-medium text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11"
          >
            Export CSV
          </button>
        </div>
      </header>

      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        {STATES.map((s) => {
          const active = filter.state === s.id || (s.id === 'all' && !filter.state);
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setQueryParam('state', s.id === 'all' ? null : s.id)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 ${
                active
                  ? 'bg-[var(--brand-primary)] text-white'
                  : 'bg-[var(--surface-subtle)] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]'
              }`}
            >
              {s.label}
            </button>
          );
        })}
        <label className="ml-2 inline-flex cursor-pointer items-center gap-2 text-xs text-[var(--fg-secondary)]">
          <input
            type="checkbox"
            checked={filter.overdueOnly ?? false}
            onChange={(e) => setQueryParam('overdueOnly', e.target.checked ? 'true' : null)}
            className="h-4 w-4 rounded border-[var(--border-subtle)] text-[var(--brand-primary)] focus:ring-[var(--border-focus)]"
          />
          Overdue only
        </label>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2">
        <input
          type="search"
          placeholder="Search by customer or invoice number…"
          defaultValue={filter.search ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            setQueryParam('search', v || null);
          }}
          className="tb-search flex-1 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:border-[var(--border-focus)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2"
        />
      </div>

      {/* Table */}
      <Card>
        <SectionHeader title="Invoices" />
        {list.isLoading ? (
          <LoadingSkeleton rows={6} />
        ) : list.isError ? (
          <ErrorState
            title="Failed to load invoices"
            message={list.error instanceof Error ? list.error.message : 'Something went wrong'}
            action={
              <Button size="sm" variant="secondary" onClick={() => refetch()}>
                Try again
              </Button>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            title="No invoices match the filters"
            message="Adjust your search or filters, or create a new invoice."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-left text-xs font-medium text-[var(--fg-secondary)]">
                  <th scope="col" className="px-4 py-3">
                    Number
                  </th>
                  <th scope="col" className="px-4 py-3">
                    State
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Customer
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Total
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Balance
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Invoice Date
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Due Date
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-[var(--border-subtle)] transition-colors hover:bg-[var(--surface-subtle)]"
                  >
                    <td className="px-4 py-3">
                      <Link
                        to={`/sales/invoices/${row.id}`}
                        className="font-medium text-[var(--brand-primary)] underline-offset-2 hover:underline"
                      >
                        {row.number}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <InvoiceStateBadge state={row.state} />
                    </td>
                    <td className="px-4 py-3 text-[var(--fg-primary)]">{row.customerName}</td>
                    <td className="px-4 py-3 text-[var(--fg-primary)]">
                      {formatMoneyMicros(row.totalMicros, row.currency)}
                    </td>
                    <td className="px-4 py-3 text-[var(--fg-primary)]">
                      {formatMoneyMicros(row.balanceMicros, row.currency)}
                    </td>
                    <td className="px-4 py-3 text-[var(--fg-secondary)]">
                      {formatDate(row.invoiceDate)}
                    </td>
                    <td className="px-4 py-3 text-[var(--fg-secondary)]">
                      {formatDate(row.dueDate)}
                      {row.daysToDue < 0 && row.state !== 'paid' && row.state !== 'cancelled' && (
                        <span className="ml-2 text-xs text-[var(--fg-error)]">
                          {Math.abs(row.daysToDue)}d overdue
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3">
          <button
            type="button"
            onClick={onPrevPage}
            disabled={cursorStack.length === 0 || list.isLoading}
            className="inline-flex min-h-9 items-center rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 py-1.5 text-xs font-medium text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11"
          >
            Previous
          </button>
          <span className="text-xs text-[var(--fg-secondary)]">
            {items.length} result{items.length !== 1 ? 's' : ''}
          </span>
          <button
            type="button"
            onClick={onNextPage}
            disabled={!hasNext || list.isLoading}
            className="inline-flex min-h-9 items-center rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 py-1.5 text-xs font-medium text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11"
          >
            Next
          </button>
        </div>
      </Card>
    </div>
  );
}

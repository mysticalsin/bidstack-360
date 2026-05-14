// /sales/orders/:id — quotation/order detail.
// Header: number, state, customer, dates, total. Then state-transition
// action buttons. Below: line items table, then an audit timeline.

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { OrderStateBadge } from '@/components/sales/OrderStateBadge';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { formatDate, formatMoneyMicros, relativeTime } from '@/lib/format';
import { useCreateInvoiceFromOrder } from '@/hooks/useInvoices';
import {
  useSalesOrder,
  useTransitionSalesOrder,
  type TransitionAction,
} from '@/hooks/useSalesOrders';

import type { OrderState } from '@bidstack/shared';

// Map next-state targets to the action endpoint they invoke.
const ACTION_FOR_TRANSITION: Record<OrderState, TransitionAction | null> = {
  draft: 'reopen',
  sent: 'send',
  confirmed: 'confirm',
  done: 'done',
  cancelled: 'cancel',
};

const ACTION_LABEL: Record<TransitionAction, string> = {
  send: 'Send to customer',
  confirm: 'Confirm as order',
  done: 'Mark as delivered',
  cancel: 'Cancel',
  reopen: 'Re-open as draft',
};

export function SalesOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const detail = useSalesOrder(id);
  const [pending, setPending] = useState<TransitionAction | null>(null);

  const send = useTransitionSalesOrder('send');
  const confirm = useTransitionSalesOrder('confirm');
  const done = useTransitionSalesOrder('done');
  const cancel = useTransitionSalesOrder('cancel');
  const reopen = useTransitionSalesOrder('reopen');
  const createInvoice = useCreateInvoiceFromOrder();
  const mutations: Record<TransitionAction, ReturnType<typeof useTransitionSalesOrder>> = {
    send,
    confirm,
    done,
    cancel,
    reopen,
  };

  if (detail.isLoading) {
    return <LoadingSkeleton rows={8} />;
  }
  if (detail.isError || !detail.data) {
    return (
      <ErrorState
        title="Couldn't load this sales order"
        message={detail.error?.message ?? 'No detail returned.'}
      />
    );
  }
  const order = detail.data;

  const onAction = (action: TransitionAction) => {
    if (!id) return;
    setPending(action);
    mutations[action]
      .mutateAsync({ id })
      .catch(() => {
        /* error surfaces via mutation state; nothing to do here */
      })
      .finally(() => setPending(null));
  };

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb">
        <ol className="flex items-center gap-2 text-xs text-[var(--fg-tertiary)]">
          <li>
            <Link to="/sales" className="hover:text-[var(--fg-primary)]">
              Sales
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li>
            <Link to="/sales/orders" className="hover:text-[var(--fg-primary)]">
              Quotations & Orders
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li aria-current="page" className="font-mono text-[var(--fg-primary)]">
            {order.number}
          </li>
        </ol>
      </nav>

      {/* Header card */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-mono text-2xl font-bold tracking-tight text-[var(--fg-primary)]">
                {order.number}
              </h1>
              {/* aria-live so screen readers announce the new state when a
                  transition (send/confirm/cancel/reopen) lands. */}
              <span role="status" aria-live="polite" aria-atomic="true">
                <OrderStateBadge state={order.state} />
              </span>
            </div>
            <p className="mt-1 text-lg text-[var(--fg-primary)]">{order.customerName}</p>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--fg-secondary)]">
              <span>
                Salesperson: <strong>{order.salespersonName ?? '—'}</strong>
              </span>
              <span>Country: {order.countryCode ?? '—'}</span>
              <span>Date: {formatDate(order.orderDate)}</span>
              {order.confirmedAt ? <span>Confirmed: {formatDate(order.confirmedAt)}</span> : null}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wider text-[var(--fg-tertiary)]">
              Total
            </div>
            <div className="text-3xl font-semibold tabular-nums text-[var(--fg-primary)]">
              {formatMoneyMicros(order.totalMicros, order.currency)}
            </div>
            <div className="text-[10px] text-[var(--fg-tertiary)]">{order.lineCount} lines</div>
          </div>
        </div>

        {/* State action buttons — show only the next legal transitions. */}
        {order.nextStates.length > 0 ? (
          <div className="border-t border-[var(--border-subtle)] px-5 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-[var(--fg-tertiary)]">Actions:</span>
              {order.nextStates.map((next) => {
                const action = ACTION_FOR_TRANSITION[next];
                if (!action) return null;
                const isDanger = action === 'cancel';
                const isPrimary = action === 'confirm' || action === 'send';
                const isPending = pending === action;
                return (
                  <Button
                    key={action}
                    size="sm"
                    variant={isPrimary ? 'primary' : isDanger ? 'destructive' : 'secondary'}
                    disabled={pending !== null}
                    aria-busy={isPending}
                    onClick={() => onAction(action)}
                  >
                    {ACTION_LABEL[action]}
                  </Button>
                );
              })}
              {(order.state === 'confirmed' || order.state === 'done') && !order.invoiceId && (
                <Button
                  size="sm"
                  variant="primary"
                  disabled={pending !== null || createInvoice.isPending}
                  aria-busy={createInvoice.isPending}
                  onClick={() => {
                    if (!id) return;
                    createInvoice.mutate({ orderId: id });
                  }}
                >
                  {createInvoice.isPending ? 'Creating…' : 'Create Invoice'}
                </Button>
              )}
              {order.invoiceId && (
                <Link
                  to={`/sales/invoices/${order.invoiceId}`}
                  className="inline-flex items-center rounded-md bg-[var(--surface-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--brand-primary)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
                >
                  View Invoice
                </Link>
              )}
            </div>
          </div>
        ) : (
          <div className="border-t border-[var(--border-subtle)] px-5 py-3 text-xs text-[var(--fg-tertiary)]">
            This order is in a terminal state — no further transitions allowed.
          </div>
        )}
      </Card>

      {/* Line items */}
      <Card>
        <SectionHeader title="Line items" caption={`${order.lines.length} entries`} />
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--fg-tertiary)]">
              <th scope="col" className="px-4 py-2 font-medium">
                SKU
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Product
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Category
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Qty
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Unit
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Subtotal
              </th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((line) => (
              <tr key={line.id} className="border-t border-[var(--border-subtle)]">
                <td className="px-4 py-2.5 font-mono text-xs text-[var(--fg-secondary)]">
                  {line.productSku}
                </td>
                <td className="px-4 py-2.5 text-[var(--fg-primary)]">{line.description}</td>
                <td className="px-4 py-2.5 text-[var(--fg-tertiary)]">
                  {line.categoryName ?? '—'}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-[var(--fg-secondary)]">
                  {Number(line.quantity).toLocaleString()}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-[var(--fg-secondary)] whitespace-nowrap">
                  {formatMoneyMicros(line.unitPriceMicros, order.currency)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-[var(--fg-primary)] whitespace-nowrap">
                  {formatMoneyMicros(line.subtotalMicros, order.currency)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[var(--border-subtle)]">
              <td
                className="px-4 py-3 text-right text-xs uppercase tracking-wider text-[var(--fg-tertiary)]"
                colSpan={5}
              >
                Total
              </td>
              <td className="px-4 py-3 text-right text-base font-bold tabular-nums text-[var(--fg-primary)] whitespace-nowrap">
                {formatMoneyMicros(order.totalMicros, order.currency)}
              </td>
            </tr>
          </tfoot>
        </table>
      </Card>

      {/* Audit trail */}
      <Card>
        <SectionHeader title="History" caption={`${order.audit.length} events`} />
        {order.audit.length === 0 ? (
          <div className="px-5 py-6 text-sm text-[var(--fg-tertiary)]">
            No history yet — created in seed.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {order.audit.map((event) => (
              <li key={event.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-[var(--fg-tertiary)] tabular-nums whitespace-nowrap">
                    {relativeTime(event.createdAt)}
                  </span>
                  <span className="font-mono text-[var(--brand-primary)]">{event.action}</span>
                  {event.fromState && event.toState ? (
                    <span className="text-[var(--fg-secondary)]">
                      {event.fromState} → {event.toState}
                    </span>
                  ) : null}
                </div>
                <span className="text-xs text-[var(--fg-secondary)]">
                  {event.actorName ?? 'system'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

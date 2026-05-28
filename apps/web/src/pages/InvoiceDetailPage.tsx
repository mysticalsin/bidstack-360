// /sales/invoices/:id — invoice detail with lines, payments, audit trail,
// and actions (record payment, send, cancel, reopen).

import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';

import { InvoiceStateBadge } from '@/components/sales/InvoiceStateBadge';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { confirm } from '@/components/ui/ConfirmDialog';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import { formatDate, formatMoneyMicros } from '@/lib/format';
import { useInvoice, useRecordPayment, useTransitionInvoice } from '@/hooks/useInvoices';

import type { PaymentMethod } from '@bidstack/shared';

const PAYMENT_METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'cash', label: 'Cash' },
  { value: 'other', label: 'Other' },
];

export function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const invoice = useInvoice(id);
  const recordPayment = useRecordPayment();
  const sendInvoice = useTransitionInvoice('send');
  const cancelInvoice = useTransitionInvoice('cancel');

  const [payOpen, setPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<PaymentMethod>('bank_transfer');
  const [payRef, setPayRef] = useState('');

  const d = invoice.data;

  const onRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !payAmount) return;
    try {
      const micros = BigInt(Math.round(parseFloat(payAmount) * 1_000_000));
      await recordPayment.mutateAsync({
        id,
        payment: {
          amountMicros: String(micros),
          currency: d?.currency ?? 'CAD',
          method: payMethod,
          reference: payRef || undefined,
          receivedAt: new Date().toISOString(),
        },
      });
      setPayOpen(false);
      setPayAmount('');
      setPayRef('');
      toast.success('Payment recorded');
    } catch (err) {
      toast.error('Could not record payment', {
        description: err instanceof Error ? err.message : 'The server rejected the request.',
      });
    }
  };

  const actionLoading = sendInvoice.isPending || cancelInvoice.isPending || recordPayment.isPending;

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-[var(--fg-primary)]">
              {d ? d.number : 'Invoice'}
            </h1>
            {d && <InvoiceStateBadge state={d.state} />}
          </div>
          <p className="mt-1 text-sm text-[var(--fg-secondary)]">
            {d ? d.customerName : 'Loading…'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex min-h-9 items-center rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] px-4 py-2 text-sm font-medium text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 pointer-coarse:min-h-11"
          >
            Print
          </button>
          {d?.state === 'draft' && (
            <button
              type="button"
              onClick={() =>
                sendInvoice.mutate(
                  { id: d.id },
                  {
                    onSuccess: () => toast.success('Invoice sent'),
                    onError: (err) =>
                      toast.error('Could not send invoice', {
                        description:
                          err instanceof Error ? err.message : 'The server rejected the request.',
                      }),
                  },
                )
              }
              disabled={actionLoading}
              className="btn-primary inline-flex min-h-9 items-center rounded-md px-4 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11"
            >
              Send Invoice
            </button>
          )}
          {(d?.state === 'draft' || d?.state === 'sent' || d?.state === 'overdue') && (
            <button
              type="button"
              onClick={async () => {
                if (
                  await confirm({
                    title: 'Cancel invoice?',
                    description: 'This cannot be undone.',
                    confirmLabel: 'Cancel Invoice',
                    destructive: true,
                  })
                ) {
                  cancelInvoice.mutate(
                    { id: d.id },
                    {
                      onSuccess: () => toast.success('Invoice cancelled'),
                      onError: (err) =>
                        toast.error('Could not cancel invoice', {
                          description:
                            err instanceof Error ? err.message : 'The server rejected the request.',
                        }),
                    },
                  );
                }
              }}
              disabled={actionLoading}
              className="inline-flex min-h-9 items-center rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] px-4 py-2 text-sm font-medium text-[var(--fg-secondary)] hover:text-[var(--fg-error)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11"
            >
              Cancel
            </button>
          )}
        </div>
      </header>

      {invoice.isLoading && <LoadingSkeleton rows={8} />}
      {invoice.isError && (
        <ErrorState
          title="Failed to load invoice"
          message={invoice.error instanceof Error ? invoice.error.message : 'Something went wrong'}
          action={
            <Button size="sm" variant="secondary" onClick={() => invoice.refetch()}>
              Try again
            </Button>
          }
        />
      )}
      {!invoice.isLoading && !invoice.isError && !d && (
        <EmptyState title="Invoice not found" message="This invoice may have been deleted." />
      )}

      {d && (
        <>
          {/* Summary grid */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <SectionHeader title="Total" />
              <p className="px-4 pb-4 text-2xl font-semibold text-[var(--fg-primary)]">
                {formatMoneyMicros(d.totalMicros, d.currency)}
              </p>
            </Card>
            <Card>
              <SectionHeader title="Paid" />
              <p className="px-4 pb-4 text-2xl font-semibold text-[var(--fg-jade)]">
                {formatMoneyMicros(d.paidMicros, d.currency)}
              </p>
            </Card>
            <Card>
              <SectionHeader title="Balance" />
              <p className="px-4 pb-4 text-2xl font-semibold text-[var(--fg-primary)]">
                {formatMoneyMicros(d.balanceMicros, d.currency)}
              </p>
            </Card>
            <Card>
              <SectionHeader title="Due" />
              <p className="px-4 pb-4 text-2xl font-semibold text-[var(--fg-primary)]">
                {formatDate(d.dueDate)}
              </p>
              {d.daysToDue < 0 && d.state !== 'paid' && d.state !== 'cancelled' && (
                <p className="px-4 pb-4 text-xs text-[var(--fg-error)]">
                  {Math.abs(d.daysToDue)} days overdue
                </p>
              )}
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Left column: lines */}
            <div className="space-y-6 lg:col-span-2">
              <Card>
                <SectionHeader title="Invoice Lines" />
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border-subtle)] text-left text-xs font-medium text-[var(--fg-secondary)]">
                        <th scope="col" className="px-4 py-3">
                          Product
                        </th>
                        <th scope="col" className="px-4 py-3">
                          Description
                        </th>
                        <th scope="col" className="px-4 py-3 text-right">
                          Qty
                        </th>
                        <th scope="col" className="px-4 py-3 text-right">
                          Unit Price
                        </th>
                        <th scope="col" className="px-4 py-3 text-right">
                          Subtotal
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.lines.map((line) => (
                        <tr key={line.id} className="border-b border-[var(--border-subtle)]">
                          <td className="px-4 py-3 text-[var(--fg-primary)]">
                            {line.productSku ?? line.productName ?? '—'}
                          </td>
                          <td className="px-4 py-3 text-[var(--fg-secondary)]">
                            {line.description}
                          </td>
                          <td className="px-4 py-3 text-right text-[var(--fg-primary)]">
                            {line.quantity}
                          </td>
                          <td className="px-4 py-3 text-right text-[var(--fg-primary)]">
                            {formatMoneyMicros(line.unitPriceMicros, d.currency)}
                          </td>
                          <td className="px-4 py-3 text-right font-medium text-[var(--fg-primary)]">
                            {formatMoneyMicros(line.subtotalMicros, d.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* Payments */}
              <Card>
                <SectionHeader title="Payments" />
                {d.payments.length === 0 ? (
                  <p className="p-4 text-sm text-[var(--fg-secondary)]">
                    No payments recorded yet.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[var(--border-subtle)] text-left text-xs font-medium text-[var(--fg-secondary)]">
                          <th scope="col" className="px-4 py-3">
                            Date
                          </th>
                          <th scope="col" className="px-4 py-3">
                            Method
                          </th>
                          <th scope="col" className="px-4 py-3">
                            Reference
                          </th>
                          <th scope="col" className="px-4 py-3 text-right">
                            Amount
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.payments.map((p) => (
                          <tr key={p.id} className="border-b border-[var(--border-subtle)]">
                            <td className="px-4 py-3 text-[var(--fg-secondary)]">
                              {formatDate(p.receivedAt)}
                            </td>
                            <td className="px-4 py-3 text-[var(--fg-primary)]">
                              {PAYMENT_METHODS.find((m) => m.value === p.method)?.label ?? p.method}
                            </td>
                            <td className="px-4 py-3 text-[var(--fg-secondary)]">
                              {p.reference ?? '—'}
                            </td>
                            <td className="px-4 py-3 text-right font-medium text-[var(--fg-jade)]">
                              {formatMoneyMicros(p.amountMicros, p.currency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              {/* Audit */}
              <Card>
                <SectionHeader title="History" />
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border-subtle)] text-left text-xs font-medium text-[var(--fg-secondary)]">
                        <th scope="col" className="px-4 py-3">
                          Date
                        </th>
                        <th scope="col" className="px-4 py-3">
                          Action
                        </th>
                        <th scope="col" className="px-4 py-3">
                          Actor
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.audit.map((a) => (
                        <tr key={a.id} className="border-b border-[var(--border-subtle)]">
                          <td className="px-4 py-3 text-[var(--fg-secondary)]">
                            {formatDate(a.createdAt)}
                          </td>
                          <td className="px-4 py-3 text-[var(--fg-primary)]">
                            {a.action}
                            {a.fromState && a.toState && (
                              <span className="ml-2 text-[var(--fg-muted)]">
                                ({a.fromState} → {a.toState})
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-[var(--fg-secondary)]">
                            {a.actorName ?? 'System'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>

            {/* Right column: record payment */}
            <div className="space-y-6">
              {(d.state === 'sent' || d.state === 'overdue' || d.state === 'draft') && (
                <Card>
                  <SectionHeader title="Record Payment" />
                  {payOpen ? (
                    <form onSubmit={onRecordPayment} className="space-y-3 p-4">
                      <div>
                        <label className="block text-xs font-medium text-[var(--fg-secondary)]">
                          Amount ({d.currency})
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          required
                          value={payAmount}
                          onChange={(e) => setPayAmount(e.target.value)}
                          className="mt-1 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--fg-primary)] focus:border-[var(--border-focus)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--fg-secondary)]">
                          Method
                        </label>
                        <select
                          value={payMethod}
                          onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
                          className="mt-1 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--fg-primary)] focus:border-[var(--border-focus)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2"
                        >
                          {PAYMENT_METHODS.map((m) => (
                            <option key={m.value} value={m.value}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--fg-secondary)]">
                          Reference
                        </label>
                        <input
                          type="text"
                          value={payRef}
                          onChange={(e) => setPayRef(e.target.value)}
                          placeholder="Cheque #, transaction ID…"
                          className="mt-1 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:border-[var(--border-focus)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2"
                        />
                      </div>
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="submit"
                          disabled={recordPayment.isPending}
                          className="btn-primary inline-flex min-h-9 items-center rounded-md px-4 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11"
                        >
                          {recordPayment.isPending ? 'Saving…' : 'Save Payment'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setPayOpen(false)}
                          className="inline-flex min-h-9 items-center rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] px-4 py-2 text-sm font-medium text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 pointer-coarse:min-h-11"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="p-4">
                      <button
                        type="button"
                        onClick={() => setPayOpen(true)}
                        className="btn-primary inline-flex min-h-9 w-full items-center justify-center rounded-md px-4 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 pointer-coarse:min-h-11"
                      >
                        Record Payment
                      </button>
                    </div>
                  )}
                </Card>
              )}

              {/* Next states hint */}
              {d.nextStates.length > 0 && (
                <Card>
                  <SectionHeader title="Available Actions" />
                  <div className="p-4">
                    <ul className="list-disc space-y-1 pl-4 text-sm text-[var(--fg-secondary)]">
                      {d.nextStates.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </div>
                </Card>
              )}

              {/* Sales order link */}
              {d.salesOrderId && (
                <Card>
                  <SectionHeader title="Sales Order" />
                  <div className="p-4">
                    <Link
                      to={`/sales/orders/${d.salesOrderId}`}
                      className="text-sm font-medium text-[var(--brand-primary)] underline-offset-2 hover:underline"
                    >
                      {d.salesOrderNumber ?? d.salesOrderId.slice(0, 8)}
                    </Link>
                  </div>
                </Card>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

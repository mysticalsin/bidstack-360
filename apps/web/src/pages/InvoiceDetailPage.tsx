// /sales/invoices/:id — invoice detail with lines, payments, audit trail, and actions.
import { useParams, Link } from 'react-router-dom';

import { InvoiceStateBadge } from '@/components/sales/InvoiceStateBadge';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { confirm } from '@/components/ui/ConfirmDialog';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import { formatDate, formatMoneyMicros } from '@/lib/format';
import { useInvoice, useTransitionInvoice } from '@/hooks/useInvoices';
import {
  InvoiceAuditTable,
  InvoiceLinesTable,
  InvoicePaymentsTable,
} from './invoiceDetail/InvoiceTables';
import { RecordPaymentCard } from './invoiceDetail/RecordPaymentCard';

export function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const invoice = useInvoice(id);
  const sendInvoice = useTransitionInvoice('send');
  const cancelInvoice = useTransitionInvoice('cancel');

  const d = invoice.data;
  const actionLoading = sendInvoice.isPending || cancelInvoice.isPending;

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
            {/* Left column: lines, payments, audit */}
            <div className="space-y-6 lg:col-span-2">
              <InvoiceLinesTable lines={d.lines} currency={d.currency} />
              <InvoicePaymentsTable payments={d.payments} />
              <InvoiceAuditTable audit={d.audit} />
            </div>

            {/* Right column: record payment, next states, sales order link */}
            <div className="space-y-6">
              <RecordPaymentCard invoiceId={d.id} currency={d.currency} state={d.state} />

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

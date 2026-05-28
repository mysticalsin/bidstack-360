// Self-contained payment recording card — owns its form state and mutation.
import { useState } from 'react';

import { Card, SectionHeader } from '@/components/ui/Card';
import { toast } from '@/components/ui/Toast';
import { useRecordPayment } from '@/hooks/useInvoices';
import type { InvoiceState, PaymentMethod } from '@bidstack/shared';
import { PAYMENT_METHODS } from './constants';

export function RecordPaymentCard({
  invoiceId,
  currency,
  state,
}: {
  invoiceId: string;
  currency: string;
  state: InvoiceState;
}) {
  const recordPayment = useRecordPayment();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('bank_transfer');
  const [ref, setRef] = useState('');

  if (state !== 'sent' && state !== 'overdue' && state !== 'draft') return null;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount) return;
    try {
      const micros = BigInt(Math.round(parseFloat(amount) * 1_000_000));
      await recordPayment.mutateAsync({
        id: invoiceId,
        payment: {
          amountMicros: String(micros),
          currency,
          method,
          reference: ref || undefined,
          receivedAt: new Date().toISOString(),
        },
      });
      setOpen(false);
      setAmount('');
      setRef('');
      toast.success('Payment recorded');
    } catch (err) {
      toast.error('Could not record payment', {
        description: err instanceof Error ? err.message : 'The server rejected the request.',
      });
    }
  };

  return (
    <Card>
      <SectionHeader title="Record Payment" />
      {open ? (
        <form onSubmit={onSubmit} className="space-y-3 p-4">
          <div>
            <label
              htmlFor="pay-amount"
              className="block text-xs font-medium text-[var(--fg-secondary)]"
            >
              Amount ({currency})
            </label>
            <input
              id="pay-amount"
              type="number"
              step="0.01"
              min="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--fg-primary)] focus:border-[var(--border-focus)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2"
            />
          </div>
          <div>
            <label
              htmlFor="pay-method"
              className="block text-xs font-medium text-[var(--fg-secondary)]"
            >
              Method
            </label>
            <select
              id="pay-method"
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
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
            <label
              htmlFor="pay-ref"
              className="block text-xs font-medium text-[var(--fg-secondary)]"
            >
              Reference
            </label>
            <input
              id="pay-ref"
              type="text"
              value={ref}
              onChange={(e) => setRef(e.target.value)}
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
              onClick={() => setOpen(false)}
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
            onClick={() => setOpen(true)}
            className="btn-primary inline-flex min-h-9 w-full items-center justify-center rounded-md px-4 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 pointer-coarse:min-h-11"
          >
            Record Payment
          </button>
        </div>
      )}
    </Card>
  );
}

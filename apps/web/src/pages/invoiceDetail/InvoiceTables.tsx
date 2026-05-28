// Pure display sub-components for InvoiceDetailPage — no hooks, no mutations.
import { Card, SectionHeader } from '@/components/ui/Card';
import { formatDate, formatMoneyMicros } from '@/lib/format';
import type { InvoiceAuditEntry, InvoiceLineDetail, PaymentEntry } from '@bidstack/shared';
import { PAYMENT_METHODS } from './constants';

export function InvoiceLinesTable({
  lines,
  currency,
}: {
  lines: InvoiceLineDetail[];
  currency: string;
}) {
  return (
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
            {lines.map((line) => (
              <tr key={line.id} className="border-b border-[var(--border-subtle)]">
                <td className="px-4 py-3 text-[var(--fg-primary)]">
                  {line.productSku ?? line.productName ?? '—'}
                </td>
                <td className="px-4 py-3 text-[var(--fg-secondary)]">{line.description}</td>
                <td className="px-4 py-3 text-right text-[var(--fg-primary)]">{line.quantity}</td>
                <td className="px-4 py-3 text-right text-[var(--fg-primary)]">
                  {formatMoneyMicros(line.unitPriceMicros, currency)}
                </td>
                <td className="px-4 py-3 text-right font-medium text-[var(--fg-primary)]">
                  {formatMoneyMicros(line.subtotalMicros, currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function InvoicePaymentsTable({ payments }: { payments: PaymentEntry[] }) {
  if (payments.length === 0) {
    return (
      <Card>
        <SectionHeader title="Payments" />
        <p className="p-4 text-sm text-[var(--fg-secondary)]">No payments recorded yet.</p>
      </Card>
    );
  }
  return (
    <Card>
      <SectionHeader title="Payments" />
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
            {payments.map((p) => (
              <tr key={p.id} className="border-b border-[var(--border-subtle)]">
                <td className="px-4 py-3 text-[var(--fg-secondary)]">{formatDate(p.receivedAt)}</td>
                <td className="px-4 py-3 text-[var(--fg-primary)]">
                  {PAYMENT_METHODS.find((m) => m.value === p.method)?.label ?? p.method}
                </td>
                <td className="px-4 py-3 text-[var(--fg-secondary)]">{p.reference ?? '—'}</td>
                <td className="px-4 py-3 text-right font-medium text-[var(--fg-jade)]">
                  {formatMoneyMicros(p.amountMicros, p.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function InvoiceAuditTable({ audit }: { audit: InvoiceAuditEntry[] }) {
  return (
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
            {audit.map((a) => (
              <tr key={a.id} className="border-b border-[var(--border-subtle)]">
                <td className="px-4 py-3 text-[var(--fg-secondary)]">{formatDate(a.createdAt)}</td>
                <td className="px-4 py-3 text-[var(--fg-primary)]">
                  {a.action}
                  {a.fromState && a.toState && (
                    <span className="ml-2 text-[var(--fg-muted)]">
                      ({a.fromState} → {a.toState})
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-[var(--fg-secondary)]">{a.actorName ?? 'System'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// Per-state tone badge for Invoices. Mirrors ERP account.move colours:
//   draft     → gray   (not yet sent)
//   sent      → blue   (awaiting payment)
//   paid      → jade   (fully paid)
//   overdue   → amber  (past due)
//   cancelled → tomato (void)

import { Badge } from '@/components/ui/Badge';

import type { InvoiceState } from '@bidstack/shared';

const TONE: Record<InvoiceState, 'gray' | 'blue' | 'jade' | 'amber' | 'tomato'> = {
  draft: 'gray',
  sent: 'blue',
  paid: 'jade',
  overdue: 'amber',
  cancelled: 'tomato',
};

const LABEL: Record<InvoiceState, string> = {
  draft: 'Draft',
  sent: 'Sent',
  paid: 'Paid',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
};

export function InvoiceStateBadge({ state }: { state: InvoiceState }) {
  return <Badge tone={TONE[state]}>{LABEL[state]}</Badge>;
}

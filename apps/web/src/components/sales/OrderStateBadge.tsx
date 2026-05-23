// Per-state tone badge for Sales Orders. Each state gets a stable color so
// users learn the mapping at a glance. Mirrors ERP's color discipline:
//   draft     → gray (no commitment)
//   sent      → blue (out for review)
//   confirmed → jade (signed)
//   done      → purple (fully delivered/locked)
//   cancelled → tomato (terminated)

import { Badge } from '@/components/ui/Badge';

import type { OrderState } from '@bidstack/shared';

const TONE: Record<OrderState, 'gray' | 'blue' | 'jade' | 'purple' | 'tomato'> = {
  draft: 'gray',
  sent: 'blue',
  confirmed: 'jade',
  done: 'purple',
  cancelled: 'tomato',
};

const LABEL: Record<OrderState, string> = {
  draft: 'Draft',
  sent: 'Sent',
  confirmed: 'Confirmed',
  done: 'Done',
  cancelled: 'Cancelled',
};

export function OrderStateBadge({ state }: { state: OrderState }) {
  return <Badge tone={TONE[state]}>{LABEL[state]}</Badge>;
}

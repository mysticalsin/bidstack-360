// Open deals on the account header. A decided bid is off this clock. A due
// day is a UTC calendar day, the same cut the bid chip uses, so noon on the
// due date is still today.
import { daysUntilDueUtc } from '@/components/ui/DueDateChip';

export interface OpenDealClock {
  stage?: string | null;
  dueDate?: string | null;
  pipelineStage?: { isWon: boolean; isLost: boolean } | null;
}

export interface OpenBookDue {
  open: number;
  overdue: number;
  /** Whole UTC days past due for the oldest late open deal. 0 when none are late. */
  oldestOverdueDays: number;
}

export function isDecidedDeal(deal: OpenDealClock): boolean {
  if (deal.pipelineStage) return deal.pipelineStage.isWon || deal.pipelineStage.isLost;
  return deal.stage === 'closed_won' || deal.stage === 'closed_lost';
}

export function openBookDue(deals: readonly OpenDealClock[], now: Date): OpenBookDue {
  let open = 0;
  let overdue = 0;
  let oldestOverdueDays = 0;
  for (const deal of deals) {
    if (isDecidedDeal(deal)) continue;
    open += 1;
    if (!deal.dueDate) continue;
    const days = daysUntilDueUtc(deal.dueDate, now);
    if (days >= 0) continue;
    overdue += 1;
    const late = Math.abs(days);
    if (late > oldestOverdueDays) oldestOverdueDays = late;
  }
  return { open, overdue, oldestOverdueDays };
}
